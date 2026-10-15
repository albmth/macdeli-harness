/** Standing research authority over native sessions, goals, schedules and persistence. */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { chmod, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-schedule'
import type {} from '@macdeli/dsh-budget'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dueWakePatch, failurePatch, freshScheduleMessages, missionProjection, terminalTurnFailurePatch, type MissionState } from './state.ts'

export const name = 'macdeli-mission'
export const inject = ['agents', 'sessions', 'sessionController', 'sessionProjections', 'storageDomain', 'goals', 'tools', 'schedule', 'sessionPersistence', 'macdeliBudget']
/** Deployment-owned mission authority and continuation policy. */
export interface Config {
  /** Enduring economic objective retained in the mission session. */
  objective: string
  /** Owner-authorized operating scope; startup rejects a changed authority. */
  authority: string
  /** Research worker directory supplied to the remote agent preset. */
  workspace: string
  /** Private Host Unix socket for owner status, pause and resume. */
  controlSocket: string
  /** Initial native round allocation; work_extend records justified increases. */
  maxGoalRounds: number
  /** Whether a newly initialized mission waits for explicit owner resume. */
  initialPaused: boolean
  /** At most two persisted delays for terminal transient provider probes. */
  probeDelaysMs: number[]
}
export const Config: schema<Config> = schema.object({
  objective: schema.string().required(), authority: schema.string().required(), workspace: schema.string().required(),
  controlSocket: schema.string().required(), maxGoalRounds: schema.number().default(12), initialPaused: schema.boolean().default(true),
  probeDelaysMs: schema.array(schema.number().min(1)).max(2).default([300_000, 1_800_000]),
})
const identity = defineDomain({ name: 'macdeli_mission', version: 1,
  global: { schema: z.object({ sessionId: z.string().nullable() }), initial: { sessionId: null as string | null } }, tables: {},
})
const output = { schema: { type: 'string' } as const, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] }

export function apply(ctx: Context, config: Config): void {
  ctx.sessionProjections.register(missionProjection)
  let active: Agent | undefined
  let stopping = false
  let queued = Promise.resolve()
  function state(agent: Agent): MissionState {
    const value = ctx.sessionProjections.stateOf(agent.session, 'quantMission')
    if (!value) throw new Error('Mission projection unavailable')
    return value
  }
  async function change(agent: Agent, patch: Partial<MissionState>): Promise<MissionState> {
    const current = state(agent)
    const next = { ...current, ...patch, revision: current.revision + 1 }
    agent.session.append('quant/mission', next)
    await ctx.sessions.flush(agent.session)
    return next
  }
  function caller(agent: Agent | undefined): Agent {
    if (!agent || agent !== active || state(agent).paused || state(agent).fault) throw new Error('Mission admission is paused or unavailable')
    return agent
  }
  function goalRef(agent: Agent) {
    const goal = ctx.goals.get(agent)
    return goal ? { id: goal.id, revision: goal.revision } : undefined
  }
  function clearGoal(agent: Agent): void {
    const ref = goalRef(agent)
    if (ref) ctx.goals.clear(agent, ref)
  }
  async function ensureWake(agent: Agent): Promise<void> {
    const current = state(agent)
    if (current.wakeAt === null || current.wakeKey === null || current.wakeAt <= Date.now()) return
    const prompt = `Quant durable wake ${current.wakeKey}. Inspect work_status and existing outputs before continuing.`
    const scheduled = await ctx.schedule.list({ sessionId: agent.id })
    if (!scheduled.some(record => record.prompt === prompt)) {
      await ctx.schedule.create(agent.id, { title: 'Quant durable wake', prompt, at: new Date(current.wakeAt).toISOString() })
    }
  }
  async function releaseDueWake(agent: Agent): Promise<void> {
    const patch = dueWakePatch(state(agent), Date.now())
    if (patch) await change(agent, patch)
  }
  async function reconcile(): Promise<void> {
    const agent = active
    if (!agent || stopping || agent.status !== 'idle') return
    const terminalFailure = terminalTurnFailurePatch(state(agent), agent.session.snapshotEvents())
    if (terminalFailure) await change(agent, terminalFailure)
    await releaseDueWake(agent)
    let current = state(agent)
    if (current.paused || current.fault) { ctx.goals.disarm(agent); if (!current.paused) await ensureWake(agent); return }
    if (current.wakeAt !== null && Date.now() < current.wakeAt) { await ensureWake(agent); return }
    if (current.work?.status === 'waiting' && current.wakeAt === null) return
    if (!current.work && !current.pendingAttention) return
    if (current.work?.status === 'blocked_external') return
    let goal = ctx.goals.get(agent)
    const work = current.work
    const running = work?.status === 'running'
    // Reconcile a crash after committing work but before binding or completing its native goal.
    if (goal && ((running && !goal.objective.startsWith(`[work_id=${work.id}]`))
      || (!running && goal.objective.startsWith('[work_id=')))) {
      clearGoal(agent); goal = undefined
    }
    if (goal && running && work.roundLimit > goal.maxGoalRounds) {
      goal = ctx.goals.edit(agent, { id: goal.id, revision: goal.revision }, { maxGoalRounds: work.roundLimit })
    }
    if (goal && goal.phase !== 'complete' && goal.roundsStarted >= goal.maxGoalRounds) {
      if (running && !work.reconsiderationUsed) {
        current = await change(agent, { work: { ...work, reconsiderationUsed: true, roundLimit: goal.maxGoalRounds + 1 } })
        goal = ctx.goals.edit(agent, { id: goal.id, revision: goal.revision }, {
          maxGoalRounds: goal.maxGoalRounds + 1,
          objective: `${goal.objective}\nAllocation exhausted. This one reconsideration round must finish/abandon or call work_extend with a material reason. Do not repeat unchanged work.`,
        })
      } else {
        if (running) current = await change(agent, { work: { ...work, status: 'abandoned',
          conclusion: 'Native round allocation and its reconsideration were exhausted without a justified extension.',
          nextAction: 'Select a different useful question or method from retained evidence.' }, pendingAttention: true })
        clearGoal(agent); goal = undefined
      }
    }
    if (goal && goal.phase !== 'complete') {
      if (goal.activation === 'disarmed') ctx.goals.resume(agent, { id: goal.id, revision: goal.revision })
    } else {
      const work = current.work
      const objective = work?.status === 'running'
        ? `[work_id=${work.id}] ${work.objective}\nStop: ${work.stopCondition}\nCheckpoint: ${work.checkpoint}`
        : `Enduring mission: ${current.objective}\nInspect inherited evidence, compare useful opportunities and select the next bounded task with work_select. Previous conclusion: ${work?.conclusion ?? 'None'}. Next action: ${work?.nextAction ?? 'Choose independently'}.`
      ctx.goals.create(agent, { objective, maxGoalRounds: work?.status === 'running' ? work.roundLimit : config.maxGoalRounds })
    }
    await ctx.sessions.flush(agent.session)
  }
  function scheduleReconcile(): void {
    queued = queued.then(reconcile).catch((error) => { ctx.logger.error('Mission reconciliation failed', error) })
  }
  ctx.on('session/event', (session, event) => {
    if (!active || session !== active.session || event.type !== 'turn/end' || event.data.reason.kind !== 'error') return
    // Session observers cannot append reentrantly. Disarm synchronously; queued reconciliation
    // flushes the fault before any mission rearm and also recovers it from the log after restart.
    ctx.goals.disarm(active)
    scheduleReconcile()
  })
  ctx.on('agent/status', ({ agent, status }) => { if (agent === active && status === 'idle') scheduleReconcile() })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent !== active) return { kind: 'reject' }
    const terminalFailure = terminalTurnFailurePatch(state(agent), agent.session.snapshotEvents())
    if (terminalFailure) await change(agent, terminalFailure)
    await releaseDueWake(agent)
    const current = state(agent)
    if (current.paused || current.fault || (current.wakeAt !== null && Date.now() < current.wakeAt)) return { kind: 'reject' }
    if ((current.work?.status === 'waiting' && current.wakeAt === null) || current.work?.status === 'blocked_external'
      || (!current.work && !current.pendingAttention)) return { kind: 'reject' }
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    if (state(agent).paused || state(agent).fault) return { kind: 'reject' }
    const filtered = freshScheduleMessages(decision.messages, state(agent).admittedEvents)
    if (decision.messages.length && !filtered.messages.length) return { kind: 'reject' }
    if (filtered.keys.length) await change(agent, { admittedEvents: [...state(agent).admittedEvents, ...filtered.keys] })
    return { ...decision, messages: filtered.messages }
  })
  ctx.on('agent/request-error', async ({ agent, failure }, next) => {
    const action = await next()
    if (action?.kind === 'retry' || agent !== active) return action
    await change(agent, failurePatch(state(agent), failure.code, failure.message, Date.now(), config.probeDelaysMs))
    const ref = goalRef(agent)
    if (ref && ctx.goals.get(agent)?.phase === 'active') ctx.goals.block(agent, ref, { code: 'provider-error', message: failure.message })
    await ensureWake(agent)
    return action
  })
  ctx.tools.register(defineTool({ name: 'work_status', description: 'Read enduring mission and durable current work. Ordinary research has standing authority.', parameters: {}, output,
    async execute(_args, exec) { return JSON.stringify(state(caller(exec.agent))) },
  }))
  ctx.tools.register(defineTool({ name: 'work_select', description: 'Choose one worthwhile bounded task after inspecting inherited evidence. This creates a native goal under standing research authority.', parameters: {
    revision: { type: 'integer', required: true }, objective: { type: 'string', required: true }, reason: { type: 'string', required: true },
    expected_output: { type: 'string', required: true }, stop_condition: { type: 'string', required: true },
    candidates: { type: 'array', items: { type: 'string' }, required: true },
  }, output, async execute(args, exec) {
    const agent = caller(exec.agent), current = state(agent)
    if (args.revision !== current.revision) throw new Error('Stale revision; read work_status')
    if (current.work?.status === 'running' || current.work?.status === 'waiting') throw new Error('Finish or abandon current work first')
    if (args.candidates.length > 5) throw new Error('Keep at most five current candidates')
    const work = { id: randomUUID(), objective: args.objective, reason: args.reason, expectedOutput: args.expected_output,
      stopCondition: args.stop_condition, status: 'running' as const, attemptId: randomUUID(), checkpoint: '', evidence: [],
      conclusion: '', nextAction: '', startedAt: Date.now() }
    const boundedWork = { ...work, roundLimit: config.maxGoalRounds, reconsiderationUsed: false, extensions: [] }
    await change(agent, { work: boundedWork, candidates: args.candidates, pendingAttention: false, wakeAt: null, wakeKey: null })
    clearGoal(agent)
    ctx.goals.create(agent, { objective: `[work_id=${work.id}] ${work.objective}\nStop: ${work.stopCondition}`, maxGoalRounds: config.maxGoalRounds })
    await ctx.sessions.flush(agent.session)
    return JSON.stringify(state(agent))
  } }))
  ctx.tools.register(defineTool({ name: 'work_extend', description: 'Justify further useful work in the same task and native goal. Extends goal rounds without resetting task identity, evidence or the cumulative financial allowance.', parameters: {
    revision: { type: 'integer', required: true }, reason: { type: 'string', required: true }, extra_rounds: { type: 'integer', required: true },
  }, output, async execute(args, exec) {
    const agent = caller(exec.agent), current = state(agent), goal = ctx.goals.get(agent)
    if (args.revision !== current.revision || current.work?.status !== 'running' || !goal || !goal.objective.startsWith(`[work_id=${current.work.id}]`)) throw new Error('Stale revision or no current task goal')
    if (!args.reason.trim()) throw new Error('A material reason for additional work is required')
    if (!Number.isSafeInteger(args.extra_rounds) || args.extra_rounds < 1) throw new Error('extra_rounds must be a positive integer')
    const roundLimit = goal.maxGoalRounds + args.extra_rounds
    await change(agent, { work: { ...current.work, roundLimit, reconsiderationUsed: false,
      extensions: [...current.work.extensions, { reason: args.reason, extraRounds: args.extra_rounds, at: Date.now() }] } })
    ctx.goals.edit(agent, { id: goal.id, revision: goal.revision }, { maxGoalRounds: roundLimit,
      objective: `[work_id=${current.work.id}] ${current.work.objective}\nStop: ${current.work.stopCondition}\nCheckpoint: ${current.work.checkpoint}\nExtension reason: ${args.reason}` })
    await ctx.sessions.flush(agent.session)
    return JSON.stringify(state(agent))
  } }))
  ctx.tools.register(defineTool({ name: 'work_checkpoint', description: 'Persist executable experiment specification, command, artifact paths, partial results and next step before expensive work. Use unique work/attempt directories; inspect prior outputs before rerunning after interruption.', parameters: {
    revision: { type: 'integer', required: true }, checkpoint: { type: 'string', required: true }, evidence: { type: 'array', items: { type: 'string' }, required: true },
  }, output, async execute(args, exec) {
    const agent = caller(exec.agent), current = state(agent)
    if (args.revision !== current.revision || !current.work) throw new Error('Stale revision or no selected work')
    return JSON.stringify(await change(agent, { work: { ...current.work, checkpoint: args.checkpoint, evidence: args.evidence } }))
  } }))
  ctx.tools.register(defineTool({ name: 'work_finish', description: 'Record actual numerical outcome and evidence, including negative or failed results, then choose another useful action. Complete means the bounded investigation finished, not that a strategy is profitable.', parameters: {
    revision: { type: 'integer', required: true }, status: { type: 'string', enum: ['done', 'abandoned'], required: true },
    conclusion: { type: 'string', required: true }, evidence: { type: 'array', items: { type: 'string' }, required: true }, next_action: { type: 'string', required: true },
  }, output, async execute(args, exec) {
    const agent = caller(exec.agent), current = state(agent)
    if (args.revision !== current.revision || !current.work) throw new Error('Stale revision or no selected work')
    await change(agent, { work: { ...current.work, status: args.status as 'done' | 'abandoned', conclusion: args.conclusion, evidence: args.evidence, nextAction: args.next_action }, pendingAttention: true })
    const ref = goalRef(agent)
    if (ref) { if (args.status === 'done') ctx.goals.complete(agent, ref); else ctx.goals.clear(agent, ref) }
    await ctx.sessions.flush(agent.session)
    exec.concludeTurn()
    return JSON.stringify(state(agent))
  } }))
  ctx.tools.register(defineTool({ name: 'work_wait', description: 'Wait deliberately for a relevant time or external change without repeated paid deliberation. Future time uses the existing Harness scheduler.', parameters: {
    revision: { type: 'integer', required: true }, reason: { type: 'string', required: true }, until: { type: 'string', required: true, description: 'UTC ISO timestamp, or empty for external dependency.' },
  }, output, async execute(args, exec) {
    const agent = caller(exec.agent), current = state(agent)
    if (args.revision !== current.revision) throw new Error('Stale revision')
    const when = args.until ? Date.parse(args.until) : null
    if (when !== null && (!Number.isFinite(when) || when <= Date.now())) throw new Error('until must be a future UTC time')
    await change(agent, { work: current.work ? { ...current.work, status: 'waiting', nextAction: args.reason } : null, wakeAt: when,
      wakeKey: when === null ? null : `work-wait:${randomUUID()}`, pendingAttention: false })
    const ref = goalRef(agent)
    if (ref && ctx.goals.get(agent)?.phase === 'active') ctx.goals.pause(agent, ref)
    if (when !== null) await ensureWake(agent)
    await ctx.sessions.flush(agent.session)
    exec.concludeTurn()
    return JSON.stringify(state(agent))
  } }))

  async function start(): Promise<void> {
    const domain = await ctx.storageDomain.open(identity)
    ctx.effect(() => () => domain.close())
    let sessionId = domain.global.get().sessionId
    if (!sessionId) {
      sessionId = `macdeli-${randomUUID()}`
      await domain.global.set({ sessionId })
    }
    const known = await ctx.sessionPersistence.stat(SessionId(sessionId))
    if (!known) await ctx.sessionController.create({ sessionId: SessionId(sessionId), cwd: config.workspace, agentPreset: 'macdeli' })
    const result = await ctx.sessionController.resolveAgent(SessionId(sessionId))
    if ('error' in result) throw result.error
    active = result.agent
    if (state(active).revision === 0) {
      await change(active, { objective: config.objective, authority: config.authority, paused: config.initialPaused })
    } else if (state(active).authority !== config.authority) throw new Error('Mission authority differs from deployment')
    await mkdir(dirname(config.controlSocket), { recursive: true, mode: 0o700 })
    // Only this deployment owns the socket; a stale socket is removed after its previous Host has exited.
    try { await unlink(config.controlSocket) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const server = createServer(async (request, response) => {
      try {
        const agent = active
        if (!agent) throw new Error('Mission not ready')
        if (request.method === 'POST' && request.url === '/pause') {
          await change(agent, { paused: true }); ctx.goals.disarm(agent); agent.cancel({ kind: 'user' }, { keepInbox: true })
        } else if (request.method === 'POST' && request.url === '/resume') {
          const work = state(agent).work
          await change(agent, { paused: false, fault: null, faultKind: null, wakeAt: null, wakeKey: null, pendingAttention: true,
            work: work?.status === 'waiting' ? { ...work, status: 'running' } : work }); scheduleReconcile()
        } else if (request.method !== 'GET' || request.url !== '/status') { response.writeHead(404).end(); return }
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ sessionId: agent.id, status: agent.status, mission: state(agent), goal: ctx.goals.get(agent),
          tools: ctx.tools.schemas(agent).map(tool => tool.name) }))
      } catch (error) { response.writeHead(500).end(JSON.stringify({ error: String(error) })) }
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.controlSocket, resolve) })
    await chmod(config.controlSocket, 0o600)
    ctx.effect(() => () => new Promise<void>((resolve) => { server.close(() => resolve()) }))
    scheduleReconcile()
  }
  ctx.effect(() => () => { stopping = true; if (active) ctx.goals.disarm(active) })
  const ready = ctx.get('appReady')
  if (!ready) throw new Error('Mission requires the normal dsh profile launcher')
  ctx.effect(() => ready.onReady(() => { void start().catch((error) => { ctx.logger.error('Mission startup failed', error) }) }))
}
