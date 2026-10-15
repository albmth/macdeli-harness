/** Restart admission regressions over the same schemas and projection used by the live mission. */
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ScheduleId } from '@deepseek-ai/dsh-schedule'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { dueWakePatch, failurePatch, freshScheduleMessages, initialState, missionProjection, missionSchema, terminalTurnFailurePatch, workSchema } from '../src/state.ts'

const delays = [300_000, 1_800_000]
const restart = (state: ReturnType<typeof initialState>) => missionSchema.parse(JSON.parse(JSON.stringify(state)))

it('persists two provider probes across restart and changing transient codes, then waits for owner recovery', () => {
  let state = initialState()
  state = restart({ ...state, ...failurePatch(state, 'SERVER', 'upstream unavailable', 1000, delays) })
  expect(state).toMatchObject({ faultKind: 'transient', providerProbes: 1, wakeAt: 301000 })
  expect(dueWakePatch(state, 300999)).toBeNull()
  state = { ...state, ...dueWakePatch(state, 301000) }
  state = restart({ ...state, ...failurePatch(state, 'TRANSPORT', 'network interrupted', 302000, delays) })
  expect(state).toMatchObject({ faultKind: 'transient', providerProbes: 2, wakeAt: 2102000 })
  state = { ...state, ...dueWakePatch(state, 2102000) }
  state = restart({ ...state, ...failurePatch(state, 'TIMEOUT', 'still unavailable', 2103000, delays) })
  expect(state).toMatchObject({ faultKind: 'owner', providerProbes: 2, wakeAt: null })
  expect(dueWakePatch(state, Number.MAX_SAFE_INTEGER)).toBeNull()
})

it('never schedules budget, authentication or configuration retries', () => {
  for (const code of ['MACDELI_BUDGET_BLOCKED', 'AUTH', 'MISSING_CREDENTIAL', 'NO_ADAPTER', 'QUOTA']) {
    const patch = failurePatch(initialState(), code, 'requires external correction', 1000, delays)
    expect(patch).toMatchObject({ wakeAt: null, wakeKey: null, providerProbes: 0 })
    expect(patch.faultKind).toBe(code === 'MACDELI_BUDGET_BLOCKED' ? 'budget' : 'owner')
  }
})

it('stops a zero-round setup failure across restart until an explicit mission transition acknowledges it', () => {
  const session = Session.create(SessionId('setup-failure'))
  const initial = { ...initialState(), revision: 1 }
  session.append('quant/mission', initial)
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'working-directory: directory does not exist' } } })
  const patch = terminalTurnFailurePatch(restart(initial), session.snapshotEvents())
  expect(patch).toMatchObject({ faultKind: 'owner', wakeAt: null, providerProbes: 0 })
  const stopped = restart({ ...initial, ...patch })
  expect(terminalTurnFailurePatch(stopped, session.snapshotEvents())).toBeNull()
  expect(dueWakePatch(stopped, Number.MAX_SAFE_INTEGER)).toBeNull()
  session.append('quant/mission', { ...initial, revision: 2 })
  expect(terminalTurnFailurePatch(initial, session.snapshotEvents())).toBeNull()
})

it('keeps pause across restart and resumes a due timed wait in the same task', () => {
  const work = workSchema.parse({ id: 'question1', objective: 'measure cost sensitivity', reason: '', expectedOutput: '',
    stopCondition: '', status: 'waiting', attemptId: 'attempt1', checkpoint: 'code and input digest retained', evidence: ['export:a'],
    conclusion: '', nextAction: 'continue after data arrival', startedAt: 1 })
  const state = restart({ ...initialState(), paused: true, work, wakeAt: 10, wakeKey: 'wake1' })
  expect(dueWakePatch(state, 20)).toBeNull()
  const resumed = restart({ ...state, paused: false })
  expect(dueWakePatch(resumed, 20)).toMatchObject({ wakeAt: null, work: { id: 'question1', attemptId: 'attempt1', status: 'running', checkpoint: 'code and input digest retained' } })
})

it('rejects replayed schedule occurrences without suppressing a distinct observation or owner message', () => {
  const reminder = (id: string) => createUserMessage({ content: [{ type: 'text', text: 'inspect evidence' }],
    source: { kind: 'schedule', occurrences: [{ schedule_id: ScheduleId(id), occurrence_at: '2026-10-15T00:00:00.000Z', occurrence_key: `${id}@2026-10-15T00:00:00.000Z` }] } })
  const first = reminder('one'), second = reminder('two')
  const admitted = freshScheduleMessages([first], [])
  const restored = restart({ ...initialState(), admittedEvents: admitted.keys })
  expect(freshScheduleMessages([first], restored.admittedEvents)).toEqual({ messages: [], keys: [] })
  const owner = createUserMessage({ content: [{ type: 'text', text: 'new observation' }], source: { kind: 'user' } })
  const next = freshScheduleMessages([first, second, owner], restored.admittedEvents)
  expect(next.messages).toEqual([second, owner])
  expect(next.keys).toEqual(['two@2026-10-15T00:00:00.000Z'])
})

it('replays durable mission events with extension history and refuses discontinuous revisions', () => {
  const session = Session.create(SessionId('mission-replay'))
  const first = { ...initialState(), revision: 1, paused: true }
  session.append('quant/mission', first)
  const second = { ...first, revision: 2, paused: false, ...failurePatch(first, 'SERVER', 'unavailable', 1000, delays) }
  session.append('quant/mission', second)
  let folded = initialState()
  for (const event of session.snapshotEvents()) folded = missionProjection.apply(folded, event)
  expect(folded).toEqual(second)
  expect(() => missionProjection.apply(initialState(), session.snapshotEvents()[1]!)).toThrow('revision')
})
