/** Real SQLite admission, crash retention and physical dispatch coverage without credentials. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { BudgetLedger, initializeBudget, readBudgetStatus, refreshTariff, requestDigest } from '../src/ledger.ts'
import { guardedAttempt } from '../src/gate.ts'
import type { DeepSeekPhysicalAttempt } from '@deepseek-ai/dsh-llm-deepseek'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

const roots: string[] = []
const ledgers: BudgetLedger[] = []
afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'macdeli-budget-')); roots.push(root)
  initializeBudget(new Date().toISOString(), root)
  const ledger = new BudgetLedger(root); ledgers.push(ledger)
  return { root, ledger }
}
const evidence = { requestDigest: requestDigest('test'), sessionId: 'task-session', purpose: 'agent', model: 'deepseek-flash', maxTokens: 8192 }
const receipt = { model: 'deepseek-flash', usage: { input_tokens: 12, output_tokens: 5, cache_read_input_tokens: 30, cache_creation_input_tokens: 7 } }
async function consume(stream: AsyncIterable<StreamChunk>) { for await (const _chunk of stream) { /* exercise the full stream */ } }
function request(purpose?: 'compaction' | 'session-title'): DeepSeekPhysicalAttempt {
  return { endpoint: 'https://api.deepseek.com/anthropic/v1/messages', receipt,
    payload: JSON.stringify({ model: 'deepseek-flash', stream: true, max_tokens: 8192, thinking: { type: 'enabled' }, output_config: { effort: 'low' }, messages: [{ role: 'user', content: [{ type: 'text', text: 'research' }] }] }),
    options: { provider: 'deepseek-official', model: 'deepseek-flash', messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'research' }] })], ...purpose === undefined ? {} : { purpose } },
  }
}
async function* complete(): AsyncGenerator<StreamChunk> {
  yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 5 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

it('reconciles all input categories at peak price and preserves spend across restart', () => {
  const { root, ledger } = fixture()
  const id = ledger.reserve(evidence)
  expect(ledger.status().chargedMicroUsd).toBe(324404)
  ledger.reconcile(id, receipt)
  expect(ledger.status().chargedMicroUsd).toBe(21)
  ledger.close()
  const restarted = new BudgetLedger(root); ledgers.push(restarted)
  expect(restarted.status().chargedMicroUsd).toBe(21)
  expect(() => initializeBudget(new Date().toISOString(), root)).toThrow()
})

it('charges incomplete attempts forever and refuses the next call before the $5 cap', () => {
  const { root, ledger } = fixture()
  for (let i = 0; i < 15; i++) ledger.uncertain(ledger.reserve(evidence), 'connection lost')
  expect(ledger.status().chargedMicroUsd).toBe(4_866_060)
  expect(() => ledger.reserve(evidence)).toThrow('insufficient unreserved headroom')
  ledger.close()
  expect(readBudgetStatus(root).chargedMicroUsd).toBe(4_866_060)
})

it('admits one physical request and one Host writer at a time', () => {
  const { root, ledger } = fixture()
  ledger.reserve(evidence)
  expect(() => ledger.reserve(evidence)).toThrow('already in flight')
  expect(() => new BudgetLedger(root)).toThrow('Another live Host')
})

it('retains a reservation through shutdown, then permits a new request after restart', () => {
  const { root, ledger } = fixture()
  ledger.reserve(evidence)
  ledger.close()
  const restarted = new BudgetLedger(root); ledgers.push(restarted)
  const next = restarted.reserve(evidence)
  restarted.reconcile(next, receipt)
  expect(restarted.status()).toMatchObject({ chargedMicroUsd: 324425, unresolved: 1 })
})

it('recovers after actual process exit without losing its unresolved reservation', () => {
  const root = mkdtempSync(join(tmpdir(), 'macdeli-budget-crash-')); roots.push(root)
  initializeBudget(new Date().toISOString(), root)
  const source = new URL('../src/ledger.ts', import.meta.url).href
  const child = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e',
    `import { BudgetLedger } from ${JSON.stringify(source)}; const ledger = new BudgetLedger(${JSON.stringify(root)}); ledger.reserve(${JSON.stringify(evidence)}); process.exit(0)`], { encoding: 'utf8' })
  expect(child.status, child.stderr).toBe(0)
  const restarted = new BudgetLedger(root); ledgers.push(restarted)
  expect(restarted.status()).toMatchObject({ chargedMicroUsd: 324404, unresolved: 1 })
  const next = restarted.reserve(evidence)
  restarted.reconcile(next, receipt)
  expect(restarted.status().chargedMicroUsd).toBe(324425)
})

it.each([
  { model: 'unexpected', usage: receipt.usage },
  { model: 'deepseek-flash', usage: { input_tokens: 1, output_tokens: 8193 } },
  { model: 'deepseek-flash', usage: { input_tokens: 1, output_tokens: -1 } },
  { model: 'deepseek-flash', usage: { input_tokens: 1, output_tokens: 1, search_tokens: 2 } },
  { model: 'deepseek-flash', usage: { input_tokens: 1, output_tokens: 1, service_tier: 'priority' } },
  { model: 'deepseek-flash', usage: { input_tokens: 1, output_tokens: 1, service_tier: null } },
])('keeps the full reservation and blocks after untrusted receipt %#', (bad) => {
  const { ledger } = fixture()
  const attempt = ledger.reserve(evidence)
  expect(() => ledger.reconcile(attempt, bad)).toThrow()
  expect(() => ledger.reviewCompleted(attempt, requestDigest(JSON.stringify(bad)), 'review cannot authorize unrecognized billing')).toThrow()
  expect(ledger.status().chargedMicroUsd).toBe(324404)
  expect(() => ledger.reserve(evidence)).toThrow()
})

it('reconciles the real standard-tier receipt and reviews its prior rejection without losing evidence', () => {
  const { root, ledger } = fixture()
  const real = { model: 'deepseek-flash', usage: { input_tokens: 7232, cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0, output_tokens: 67, service_tier: 'standard' } }
  const attempt = ledger.reserve(evidence)
  ledger.reconcile(attempt, real)
  expect(ledger.status()).toMatchObject({ chargedMicroUsd: 2250, unresolved: 0 })
  ledger.close()
  // Reproduce the prior release's durable rejection, using the exact real receipt.
  const db = new DatabaseSync(join(root, 'budget.sqlite'))
  const reason = 'Unrecognized provider usage category: service_tier'
  db.prepare("UPDATE attempts SET charged=reserved,state='uncertain',outcome=? WHERE attempt_id=?").run(reason, attempt)
  db.prepare('UPDATE control SET blocked=? WHERE id=1').run(reason)
  db.close()
  const reviewed = new BudgetLedger(root); ledgers.push(reviewed)
  expect(() => reviewed.reviewCompleted(attempt, requestDigest('wrong receipt'), 'verified contract')).toThrow('identity')
  expect(reviewed.status().chargedMicroUsd).toBe(324404)
  reviewed.reviewCompleted(attempt, requestDigest(JSON.stringify(real)), 'Official service tier contract reviewed; standard is ordinary tier metadata')
  expect(reviewed.status()).toMatchObject({ attempts: 1, chargedMicroUsd: 2250, blocked: null, unresolved: 0 })
  const inspect = new DatabaseSync(join(root, 'budget.sqlite'))
  const row = inspect.prepare('SELECT receipt,reserved,outcome FROM attempts WHERE attempt_id=?').get(attempt)!
  expect(JSON.parse(String(row.receipt))).toEqual(real)
  expect(row.reserved).toBe(324404)
  expect(JSON.parse(String(row.outcome))).toMatchObject({ previousOutcome: reason, previousCharge: 324404 })
  inspect.close()
})

it('fails closed for expired tariffs and missing previously initialized ledger', () => {
  const { root, ledger } = fixture()
  refreshTariff(new Date(Date.now() - 3_600_001).toISOString(), root)
  expect(() => ledger.reserve(evidence)).toThrow('older than one hour')
  ledger.close()
  unlinkSync(join(root, 'budget.sqlite'))
  expect(() => new BudgetLedger(root)).toThrow('missing, corrupt or inconsistent')
})

it('refuses changed identity without replacing prior accounting', () => {
  const { root, ledger } = fixture()
  ledger.close()
  const path = join(root, 'budget-authority.json')
  const value = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...value, budgetId: 'another' }))
  expect(() => new BudgetLedger(root)).toThrow('missing, corrupt or inconsistent')
})

it('accounts direct, compaction and helper requests at the same physical seam', async () => {
  const { ledger } = fixture()
  for (const purpose of [undefined, 'compaction', 'session-title'] as const) await consume(guardedAttempt(ledger, request(purpose), complete))
  expect(ledger.status()).toMatchObject({ attempts: 3, chargedMicroUsd: 63 })
})

it('accounts every failed physical attempt and retry without refunding a lost stream', async () => {
  const { ledger } = fixture()
  async function* lost(): AsyncGenerator<StreamChunk> { throw new Error('lost response') }
  await expect(consume(guardedAttempt(ledger, request(), lost))).rejects.toThrow('lost response')
  await consume(guardedAttempt(ledger, request(), complete))
  expect(ledger.status()).toMatchObject({ attempts: 2, unresolved: 1, chargedMicroUsd: 324425 })
})

it.each(['endpoint', 'output', 'search'])('refuses unauthorized %s before dispatch', async (kind) => {
  const { ledger } = fixture()
  const req = request()
  if (kind === 'endpoint') req.endpoint = 'https://another-provider.test/messages'
  else {
    const body = JSON.parse(req.payload)
    if (kind === 'output') body.max_tokens = 8193
    else body.tools = [{ type: 'web_search' }]
    req.payload = JSON.stringify(body)
  }
  let dispatched = false
  async function* next() { dispatched = true; yield* complete() }
  await expect(consume(guardedAttempt(ledger, req, next))).rejects.toMatchObject({ code: 'MACDELI_BUDGET_BLOCKED' })
  expect(dispatched).toBe(false)
  expect(ledger.status().attempts).toBe(0)
})
