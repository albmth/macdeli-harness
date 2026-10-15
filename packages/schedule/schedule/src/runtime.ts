/** Host timer over stored tasks; Session activation is a delivery operation. */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { isRecurringScheduleRecord, renderReminderFraming, renderRecurringReminderBatchFraming, resolveRecurringOccurrence } from './domain.ts'
import type { DeliveryRetentionBounds, RecurringScheduleRecord, ScheduleOccurrence } from './types.ts'
import type { ScheduleTask } from './storage.ts'
import { appendDelivery } from './delivery-history.ts'

/** Largest delay Node timers represent without clamping. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Owns at most one timer across recomputations; delivery and management share the serialized operation. */
export class ScheduleRuntime {
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private stopping = false
  private requested = false

  /**
   * @param ctx - Host services used to resume and enqueue.
   * @param tasks - Current durable tasks.
   * @param transact - Serialize delivery against management writes.
   * @param commit - Persist task status, target, receipt, and history together after durable inbox delivery.
   */
  constructor(
    private readonly ctx: Context,
    private readonly tasks: () => readonly ScheduleTask[],
    private readonly transact: (work: () => Promise<void>) => Promise<void>,
    private readonly commit: (task: ScheduleTask) => Promise<void>,
    private readonly retention: DeliveryRetentionBounds,
  ) {}

  /**
   * Recompute the nearest obligation after startup or a durable change.
   * Delivery failures retain a durable retry time on the original task.
   */
  requestDrive(): void {
    if (this.stopping) return
    this.requested = true
    this.clearTimer()
    if (this.running !== undefined) return
    let run: Promise<void>
    try {
      run = this.ctx.agents.withoutInitiator(async () => {
        while (this.requested && !this.stopping) {
          this.requested = false
          await this.transact(async () => { await this.drive() })
        }
      })
    } catch (error: unknown) {
      // Ancestor unloading closes initiator admission before runtime cleanup runs.
      this.requested = false
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
      return
    }
    this.running = run
    void run.catch((error: unknown) => {
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
    }).finally(() => {
      this.running = undefined
      if (this.requested && !this.stopping) this.requestDrive()
    })
  }

  /** Stop the timer and drain an accepted delivery before storage closes. */
  async dispose(): Promise<void> {
    this.stopping = true
    this.clearTimer()
    // requestDrive reports execution failures; teardown only waits for quiescence.
    await this.running?.catch(() => undefined)
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async drive(): Promise<void> {
    this.clearTimer()
    const failed = new Set<string>()
    const handled = new Set<string>()
    const scanNow = Date.now()
    const due = this.tasks().filter(task => task.status === 'active' && deliveryTarget(task) <= scanNow)
    for (const task of due) {
      if (this.stopping) return
      if (handled.has(task.record.id)) continue
      const group = isRecurringScheduleRecord(task.record)
        ? due.filter(candidate => candidate.sessionId === task.sessionId && isRecurringScheduleRecord(candidate.record))
        : [task]
      for (const member of group) handled.add(member.record.id)
      let admitted = group
      const committed = new Set<ScheduleTask['record']['id']>()
      try {
        const resolved = await this.ctx.sessionController.resolveAgent(task.sessionId)
        if ('error' in resolved) throw resolved.error
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- Disposal can run while Session restoration is awaited.
        if (this.stopping) return
        const now = Date.now()
        // Session restoration can span a wall-clock rollback; future members keep their timer obligation.
        admitted = group.filter(member => deliveryTarget(member) <= now)
        if (admitted.length === 0) continue
        const recurring = admitted.filter((member): member is ScheduleTask & { record: RecurringScheduleRecord } =>
          isRecurringScheduleRecord(member.record))
        const occurrences = recurring.map(member => ({
          task: member, occurrence: resolveRecurringOccurrence(member.record, now),
        }))
        const identities: ScheduleOccurrence[] = admitted.map((member) => {
          const occurrenceAt = occurrences.find(item => item.task.record.id === member.record.id)?.occurrence.occurrenceAt
            ?? member.record.scheduledAt
          return { schedule_id: member.record.id, occurrence_at: occurrenceAt, occurrence_key: `${member.record.id}@${occurrenceAt}` }
        })
        // Inbox insertion and task advancement are separate durable writes. The
        // original inbox event is sufficient evidence to avoid another insertion.
        const delivered = new Map<string, UserMessage>()
        for (const event of resolved.agent.session.snapshotEvents()) {
          if (event.type !== 'agent/inbox/spliced') continue
          for (const message of event.data.inserted) {
            if (message.source.kind !== 'schedule') continue
            for (const identity of message.source.occurrences ?? []) delivered.set(identity.occurrence_key, message)
          }
        }
        const fresh = identities.filter(identity => !delivered.has(identity.occurrence_key))
        if (fresh.length > 0) {
          const text = isRecurringScheduleRecord(task.record)
            ? renderRecurringReminderBatchFraming(occurrences
              .filter(item => fresh.some(identity => identity.schedule_id === item.task.record.id))
              .map(({ task: member, occurrence }) => ({ record: member.record, occurrenceAt: occurrence.occurrenceAt })))
            : renderReminderFraming(task.record)
          const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'schedule', occurrences: fresh } })
          resolved.agent.followup(message)
          for (const identity of fresh) delivered.set(identity.occurrence_key, message)
        }
        const flushed = await this.ctx.sessions.flush(resolved.agent.session)
        if (!flushed) throw new Error('Session persistence did not acknowledge the reminder')
        const deliveredAt = new Date(Date.now()).toISOString()
        for (const member of admitted) {
          const identity = identities.find(item => item.schedule_id === member.record.id)
          const message = identity && delivered.get(identity.occurrence_key)
          if (!identity || !message) throw new Error('Missing delivered schedule occurrence')
          const occurrence = occurrences.find(item => item.task.record.id === member.record.id)?.occurrence
          const { deliveryRetry: _retry, ...settled } = member
          await this.commit({
            ...settled,
            record: occurrence === undefined ? member.record
              : { ...member.record, scheduledAt: occurrence.nextScheduledAt ?? occurrence.occurrenceAt },
            status: occurrence?.nextScheduledAt === undefined ? 'inactive' : 'active',
            ...appendDelivery(member, { scheduledAt: identity.occurrence_at, deliveredAt, messageId: message.id }, this.retention),
          })
          committed.add(member.record.id)
        }
      } catch (error: unknown) {
        // Successful commits and targets made future by clock rollback keep their timer obligation.
        const pending = admitted.filter(member => !committed.has(member.record.id))
        const failedAt = Date.now()
        for (const member of pending) {
          if (Date.parse(member.record.scheduledAt) > failedAt) continue
          const failures = Math.min((member.deliveryRetry?.failures ?? 0) + 1, Number.MAX_SAFE_INTEGER)
          const delay = [5_000, 30_000, 300_000][failures - 1] ?? 3_600_000
          try {
            await this.commit({ ...member, deliveryRetry: { failures,
              nextAttemptAt: new Date(failedAt + delay).toISOString(), lastError: String(error).slice(0, 1000) } })
          } catch (writeError) {
            failed.add(member.record.id)
            this.ctx.logger.warn(`schedule: could not persist delivery retry for ${member.record.id}: ${String(writeError)}`)
          }
        }
        const ids = pending.map(member => member.record.id)
        this.ctx.logger.warn(`schedule: reminders ${JSON.stringify(ids)} were not acknowledged: ${String(error)}`)
      }
    }
    if (this.stopping) return
    const next = this.tasks().filter(task => task.status === 'active' && !failed.has(task.record.id))
      .reduce<number | undefined>((at, task) => {
        const target = deliveryTarget(task)
        return at === undefined ? target : Math.min(at, target)
      }, undefined)
    if (next !== undefined) {
      this.timer = setTimeout(() => { this.timer = undefined; this.requestDrive() },
        Math.max(0, Math.min(next - Date.now(), MAX_TIMER_DELAY_MS)))
      this.timer.unref()
    }
  }
}

/** Recovery never advances the reminder's economic occurrence timestamp. */
function deliveryTarget(task: ScheduleTask): number {
  return Math.max(Date.parse(task.record.scheduledAt), task.deliveryRetry === undefined ? 0 : Date.parse(task.deliveryRetry.nextAttemptAt))
}
