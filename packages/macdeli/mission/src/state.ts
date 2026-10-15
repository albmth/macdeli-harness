/** Durable mission state folded from the native Harness session. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-schedule'

/** Durable task lineage, evidence references and extendable native round allocation. */
export const workSchema = z.object({
  id: z.string().min(1), objective: z.string().min(1), reason: z.string(), expectedOutput: z.string(),
  stopCondition: z.string(), status: z.enum(['running', 'waiting', 'done', 'abandoned', 'blocked_external']),
  attemptId: z.string(), checkpoint: z.string(), evidence: z.array(z.string()), conclusion: z.string(),
  nextAction: z.string(), startedAt: z.number(),
  roundLimit: z.number().int().positive().default(12), reconsiderationUsed: z.boolean().default(false),
  extensions: z.array(z.object({ reason: z.string(), extraRounds: z.number().int().positive(), at: z.number() })).default([]),
})
/** Restart admission state; newer optional fields preserve the initial deployed record. */
export const missionSchema = z.object({
  revision: z.number().int().nonnegative(), objective: z.string(), authority: z.string(), paused: z.boolean(),
  work: workSchema.nullable(), candidates: z.array(z.string()).max(5),
  pendingAttention: z.boolean(), wakeAt: z.number().nullable(), fault: z.string().nullable(),
  admittedEvents: z.array(z.string()), lastError: z.string().nullable(), repeatedErrors: z.number().int(),
  faultKind: z.enum(['transient', 'owner', 'budget']).nullable().default(null),
  providerProbes: z.number().int().min(0).max(2).default(0), wakeKey: z.string().nullable().default(null),
})
/** Revisioned mission projection restored from required Session records. */
export type MissionState = z.infer<typeof missionSchema>
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete revisioned mission, pause, work checkpoint and attention state under standing owner authority.
     * Required for safe restart admission.
     */
    'quant/mission': MissionState
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { quantMission: MissionState }
}
/**
 * Empty projection before the deployment initializes its mission session.
 * @returns uninitialized mission admission state.
 */
export const initialState = (): MissionState => ({
  revision: 0, objective: '', authority: '', paused: false, work: null, candidates: [],
  pendingAttention: true, wakeAt: null, fault: null, admittedEvents: [], lastError: null, repeatedErrors: 0,
  faultKind: null, providerProbes: 0, wakeKey: null,
})

/**
 * Classify a terminal request after native retry declines it, retaining probes across restart.
 * @param state - current durable mission state.
 * @param code - provider-neutral terminal failure code.
 * @param message - observed failure description.
 * @param now - failure time in epoch milliseconds.
 * @param probeDelaysMs - authorized delays for at most two transient probes.
 * @returns admission fault and its optional durable wake.
 */
export function failurePatch(
  state: MissionState, code: string, message: string, now: number, probeDelaysMs: readonly number[],
): Partial<MissionState> {
  const transient = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'].includes(code)
  const delay = transient ? probeDelaysMs[state.providerProbes] : undefined
  const wakeAt = delay === undefined ? null : now + delay
  return { fault: `${code}: ${message}`, faultKind: code === 'MACDELI_BUDGET_BLOCKED' ? 'budget' : delay === undefined ? 'owner' : 'transient',
    providerProbes: state.providerProbes + (delay === undefined ? 0 : 1), wakeAt,
    wakeKey: wakeAt === null ? null : `provider-probe:${state.providerProbes + 1}:${wakeAt}`,
    lastError: code, repeatedErrors: state.lastError === code ? state.repeatedErrors + 1 : 1 }
}

/**
 * Remove already admitted schedule occurrences while retaining unrelated inbox input.
 * @param messages - native pre-step messages proposed for admission.
 * @param admitted - previously persisted occurrence identities.
 * @returns retained messages and fresh identities to persist before admission.
 */
export function freshScheduleMessages(messages: UserMessage[], admitted: readonly string[]): { messages: UserMessage[]; keys: string[] } {
  const seen = new Set(admitted), keys: string[] = []
  const retained = messages.filter((message) => {
    if (message.source.kind !== 'schedule' || !message.source.occurrences?.length) return true
    const fresh = message.source.occurrences.filter(item => !seen.has(item.occurrence_key))
    for (const item of fresh) { seen.add(item.occurrence_key); keys.push(item.occurrence_key) }
    return fresh.length > 0
  })
  return { messages: retained, keys }
}

/**
 * Complete a due timed wait without clearing owner pause or non-retryable faults.
 * @param state - current durable mission state.
 * @param now - current epoch milliseconds.
 * @returns resumed work state, or null when waiting remains necessary.
 */
export function dueWakePatch(state: MissionState, now: number): Partial<MissionState> | null {
  if (state.paused || state.wakeAt === null || state.wakeAt > now || (state.fault !== null && state.faultKind !== 'transient')) return null
  return { wakeAt: null, wakeKey: null, fault: null, faultKind: null, pendingAttention: true,
    work: state.work?.status === 'waiting' ? { ...state.work, status: 'running' } : state.work }
}

/**
 * Stop unhandled turn failures, including failures before any model round starts.
 * @param state - current durable mission state.
 * @param events - current append-only Session history.
 * @returns an owner fault for an unacknowledged failure, otherwise null.
 */
export function terminalTurnFailurePatch(state: MissionState, events: readonly SessionEvent[]): Partial<MissionState> | null {
  if (state.fault !== null) return null
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (!event) continue
    // A later explicit mission transition, including owner resume, acknowledges the old failure.
    if (event.type === 'quant/mission') return null
    if (event.type !== 'turn/end') continue
    if (event.data.reason.kind !== 'error') return null
    const { code, message } = event.data.reason.error
    return failurePatch(state, code, message, event.time, [])
  }
  return null
}
/** Native Session projection; successful model output closes transient provider incidents. */
export const missionProjection = {
  key: 'quantMission', stateVersion: 2, stateSchema: missionSchema, init: initialState,
  apply(state, event) {
    if (event.type === 'assistant/message' && state.providerProbes > 0 && state.fault === null) {
      return { ...state, providerProbes: 0, lastError: null, repeatedErrors: 0 }
    }
    if (event.type !== 'quant/mission') return state
    const next = missionSchema.parse(event.data)
    if (next.revision !== state.revision + 1) throw new Error('Invalid quant mission revision')
    return next
  },
} satisfies ProjectionDefinition<'quantMission', MissionState>
