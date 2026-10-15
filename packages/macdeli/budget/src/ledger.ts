/** Durable cumulative accounting for the owner-authorized initial allowance. */
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** This identity survives sessions, worktrees and release replacement. */
export const CONTROL_ROOT = '/Users/abxnah/DEV_THINGS/TheMacDeliFund/.quant/control'
/** Initial owner-authorized cumulative ceiling, in integer micro-USD. */
export const CAP = 5_000_000
/** Approved input capacity; no heuristic token estimator is a hard bound. */
export const INPUT_LIMIT = 1_048_576
/** Approved maximum generated tokens including reasoning. */
export const OUTPUT_LIMIT = 8192
const TARIFF_TTL_MS = 60 * 60 * 1000
const PRICE_REVISION = 'deepseek-flash-peak-0.30-1.20-2026-10-15'

/** Terminal admission failure; retry policies must not treat this as transport failure. */
export class BudgetError extends Error {
  /** Terminal code consumed by mission admission and retry handling. */
  readonly code = 'MACDELI_BUDGET_BLOCKED'
}

interface Authority { budgetId: string; cap: number; ledger: string }
interface Tariff { revision: string; verifiedAt: string; inputMicroUsdPerMillion: number; outputMicroUsdPerMillion: number }

/** Public accounting totals, deliberately distinct from a discounted provider invoice. */
export interface BudgetStatus {
  budgetId: string
  capMicroUsd: number
  chargedMicroUsd: number
  remainingMicroUsd: number
  attempts: number
  unresolved: number
  blocked: string | null
}

/** Request evidence retained without credentials or full prompts. */
export interface AttemptEvidence {
  requestDigest: string
  sessionId: string | null
  purpose: string
  model: string
  maxTokens: number
}

/** Preserve response identity and raw counters, including unknown fields. */
export interface Receipt { model?: string; usage: Record<string, unknown> }

function json(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { throw new BudgetError(`Budget control file cannot be read: ${path}`, { cause: error }) }
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new BudgetError('Invalid budget control record')
  return value as Record<string, unknown>
}
function authority(root: string): Authority {
  const value = record(json(join(root, 'budget-authority.json')))
  if (typeof value.budgetId !== 'string' || !value.budgetId || value.cap !== CAP || value.ledger !== join(root, 'budget.sqlite')) {
    throw new BudgetError('Budget identity, fixed path or initial cap differs from deployment authority')
  }
  return { budgetId: value.budgetId, cap: CAP, ledger: value.ledger }
}
function tariff(root: string, now: number): Tariff {
  const value = record(json(join(root, 'budget-tariff.json')))
  const verifiedAt = typeof value.verifiedAt === 'string' ? Date.parse(value.verifiedAt) : NaN
  if (value.revision !== PRICE_REVISION || value.inputMicroUsdPerMillion !== 300000 || value.outputMicroUsdPerMillion !== 1200000
    || !Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt >= TARIFF_TTL_MS) {
    throw new BudgetError('Approved public tariff is missing, changed, future-dated or older than one hour; paid calls are blocked')
  }
  return { revision: PRICE_REVISION, verifiedAt: String(value.verifiedAt),
    inputMicroUsdPerMillion: 300000, outputMicroUsdPerMillion: 1200000 }
}
function openExisting(root: string): { db: DatabaseSync; identity: Authority } {
  const identity = authority(root)
  try {
    if (!statSync(identity.ledger).isFile()) throw new Error('not a file')
    const db = new DatabaseSync(identity.ledger)
    db.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;')
    const integrity = db.prepare('PRAGMA quick_check').get()
    if (integrity?.quick_check !== 'ok') { db.close(); throw new Error('SQLite integrity check failed') }
    const stored = db.prepare('SELECT budget_id, cap FROM control WHERE id=1').get()
    if (stored?.budget_id !== identity.budgetId || stored.cap !== CAP) { db.close(); throw new Error('ledger identity differs') }
    return { db, identity }
  } catch (error) { throw new BudgetError('Initialized cumulative ledger is missing, corrupt or inconsistent; never recreate it to restore spending', { cause: error }) }
}
function cost(input: number, output: number): number { return Math.ceil((input * 3 + output * 12) / 10) }
function count(raw: unknown, label: string): number {
  if (!Number.isSafeInteger(raw) || typeof raw !== 'number' || raw < 0) throw new BudgetError(`Invalid reported ${label}`)
  return raw
}

function receiptCharge(receipt: Receipt, maxTokens: number, reserved: number): number {
  if (receipt.model !== 'deepseek-flash') throw new BudgetError(`Unexpected returned model: ${String(receipt.model)}`)
  const usage = record(receipt.usage)
  const known = new Set(['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'service_tier'])
  for (const key of Object.keys(usage)) if (!known.has(key)) throw new BudgetError(`Unrecognized provider usage category: ${key}`)
  // DeepSeek ignores request service_tier; Anthropic usage.service_tier is assigned-tier
  // metadata. Only the observed ordinary tier is covered by our verified DeepSeek tariff.
  if ('service_tier' in usage && usage.service_tier !== 'standard') throw new BudgetError('Unapproved provider service tier')
  const input = count(usage.input_tokens, 'input tokens') + count(usage.cache_read_input_tokens ?? 0, 'cache-read tokens') + count(usage.cache_creation_input_tokens ?? 0, 'cache-write tokens')
  const output = count(usage.output_tokens, 'output tokens including thinking')
  if (input > INPUT_LIMIT || output > maxTokens) throw new BudgetError('Reported token usage exceeds approved request limits')
  const charge = cost(input, output)
  if (charge > reserved) throw new BudgetError('Reported charge exceeds conservative reservation')
  return charge
}

/**
 * Initialize exactly once after independent public tariff verification.
 * @param verifiedAt - timestamp of the actual pricing/model documentation check.
 * @param root - trusted control directory; production callers use CONTROL_ROOT.
 * @returns the initialized durable identity.
 */
export function initializeBudget(verifiedAt: string, root = CONTROL_ROOT): string {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const budgetId = randomUUID()
  const ledger = join(root, 'budget.sqlite')
  // Publish the non-resettable marker first. Partial initialization fails closed.
  writeFileSync(join(root, 'budget-authority.json'), JSON.stringify({ budgetId, cap: CAP, ledger }) + '\n', { flag: 'wx', mode: 0o600 })
  closeSync(openSync(ledger, 'wx', 0o600))
  const db = new DatabaseSync(ledger)
  try {
    db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE control(id INTEGER PRIMARY KEY CHECK(id=1), budget_id TEXT NOT NULL, cap INTEGER NOT NULL, blocked TEXT);
      CREATE TABLE writer(id INTEGER PRIMARY KEY CHECK(id=1), host_id TEXT NOT NULL, pid INTEGER NOT NULL);
      CREATE TABLE attempts(attempt_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, created_at TEXT NOT NULL,
        session_id TEXT, purpose TEXT NOT NULL, request_digest TEXT NOT NULL, model TEXT NOT NULL,
        max_tokens INTEGER NOT NULL, price_revision TEXT NOT NULL, reserved INTEGER NOT NULL,
        charged INTEGER NOT NULL CHECK(charged>=0), state TEXT NOT NULL, receipt TEXT, outcome TEXT);
      CREATE INDEX attempts_state ON attempts(state);`)
    db.prepare('INSERT INTO control VALUES(1, ?, ?, NULL)').run(budgetId, CAP)
  } finally { db.close() }
  refreshTariff(verifiedAt, root)
  return budgetId
}

/**
 * Record an independently verified unchanged tariff without resetting spend.
 * @param verifiedAt - actual public documentation verification timestamp.
 * @param root - trusted control directory.
 */
export function refreshTariff(verifiedAt: string, root = CONTROL_ROOT): void {
  const { db } = openExisting(root)
  db.close()
  if (!Number.isFinite(Date.parse(verifiedAt)) || Date.parse(verifiedAt) > Date.now()) throw new BudgetError('Invalid tariff verification time')
  writeFileSync(join(root, 'budget-tariff.json'), JSON.stringify({ revision: PRICE_REVISION, verifiedAt,
    inputMicroUsdPerMillion: 300000, outputMicroUsdPerMillion: 1200000,
    sources: ['https://api-docs.deepseek.com/quick_start/pricing/', 'https://api-docs.deepseek.com/api/list-models/'] }) + '\n', { mode: 0o600 })
}

/**
 * Read accounting without acquiring the single Host writer role.
 * @param root - trusted control directory.
 * @returns conservative accounted spend and unresolved attempts.
 */
export function readBudgetStatus(root = CONTROL_ROOT): BudgetStatus {
  const { db, identity } = openExisting(root)
  try { return statusOf(db, identity) } finally { db.close() }
}
function statusOf(db: DatabaseSync, identity: Authority): BudgetStatus {
  const totals = record(db.prepare("SELECT COALESCE(SUM(charged),0) AS charged, COUNT(*) AS attempts, SUM(CASE WHEN state!='reconciled' THEN 1 ELSE 0 END) AS unresolved FROM attempts").get())
  const control = record(db.prepare('SELECT blocked FROM control WHERE id=1').get())
  const blocked = control.blocked
  if (blocked !== null && typeof blocked !== 'string') throw new BudgetError('Invalid stored budget block')
  const charged = Number(totals.charged)
  return { budgetId: identity.budgetId, capMicroUsd: CAP, chargedMicroUsd: charged, remainingMicroUsd: CAP - charged,
    attempts: Number(totals.attempts), unresolved: Number(totals.unresolved ?? 0), blocked }
}

/** Single Host writer with transactionally admitted physical attempts. */
export class BudgetLedger {
  private readonly db: DatabaseSync
  private readonly identity: Authority
  private readonly hostId = randomUUID()
  private closed = false
  constructor(private readonly root = CONTROL_ROOT) {
    const opened = openExisting(root)
    this.db = opened.db
    this.identity = opened.identity
    try {
      this.transaction(() => {
        const writer = this.db.prepare('SELECT pid FROM writer WHERE id=1').get()
        if (writer) {
          let alive = true
          try { process.kill(Number(writer.pid), 0) }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false }
          if (alive) throw new BudgetError('Another live Host owns the cumulative model ledger')
        }
        this.db.prepare("UPDATE attempts SET state='uncertain', outcome='Host interrupted before settlement' WHERE state='reserved'").run()
        this.db.prepare('INSERT OR REPLACE INTO writer VALUES(1, ?, ?)').run(this.hostId, process.pid)
      })
    } catch (error) { this.db.close(); throw error }
  }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = action(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  /**
   * Read the authoritative cumulative totals without changing reservations.
   * @returns cumulative accounting status, including unresolved reservations.
   */
  status(): BudgetStatus { return statusOf(this.db, this.identity) }
  /**
   * Commit the conservative maximum before physical dispatch.
   * @param evidence - effective bounded request and attribution.
   * @returns unique physical attempt id.
   */
  reserve(evidence: AttemptEvidence): string {
    const pricing = tariff(this.root, Date.now())
    if (evidence.model !== 'deepseek-flash' || !Number.isSafeInteger(evidence.maxTokens) || evidence.maxTokens < 1 || evidence.maxTokens > OUTPUT_LIMIT) throw new BudgetError('Unapproved model or output limit')
    return this.transaction(() => {
      const state = this.status()
      if (state.blocked) throw new BudgetError(state.blocked)
      const active = this.db.prepare("SELECT attempt_id FROM attempts WHERE host_id=? AND state='reserved'").get(this.hostId)
      if (active) throw new BudgetError('One model request is already in flight')
      const reservation = cost(INPUT_LIMIT, evidence.maxTokens)
      if (state.chargedMicroUsd + reservation > CAP) throw new BudgetError('Initial cumulative $5 allowance has insufficient unreserved headroom')
      const attempt = randomUUID()
      this.db.prepare('INSERT INTO attempts VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)').run(
        attempt, this.hostId, new Date().toISOString(), evidence.sessionId, evidence.purpose, evidence.requestDigest,
        evidence.model, evidence.maxTokens, pricing.revision, reservation, reservation, 'reserved')
      return attempt
    })
  }
  /**
   * Reconcile a complete trustworthy response, or persist a permanent admission block.
   * @param attempt - previously committed physical attempt id.
   * @param receipt - returned model and cumulative provider counters.
   */
  reconcile(attempt: string, receipt: Receipt): void {
    this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM attempts WHERE attempt_id=? AND host_id=? AND state=\'reserved\'').get(attempt, this.hostId)
      if (!row) throw new BudgetError('Attempt is not reserved by this Host')
      let charge: number
      try {
        charge = receiptCharge(receipt, Number(row.max_tokens), Number(row.reserved))
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        this.db.prepare("UPDATE attempts SET state='uncertain', receipt=?, outcome=? WHERE attempt_id=?").run(JSON.stringify(receipt), reason, attempt)
        this.db.prepare('UPDATE control SET blocked=? WHERE id=1').run(reason)
        return
      }
      this.db.prepare("UPDATE attempts SET charged=?, state='reconciled', receipt=?, outcome='complete' WHERE attempt_id=?").run(charge, JSON.stringify(receipt), attempt)
    })
    const blocked = this.status().blocked
    if (blocked) throw new BudgetError(blocked)
  }
  /**
   * Owner maintenance only: validate a previously retained complete receipt after review.
   * No model-facing tool exposes this method; the original reservation and receipt remain.
   * @param attempt - specific completed attempt whose usage caused the admission block.
   * @param receiptDigest - independently inspected stored receipt's exact SHA-256.
   * @param reason - bounded explanation and source evidence for the reviewed contract fix.
   */
  reviewCompleted(attempt: string, receiptDigest: string, reason: string): void {
    if (!reason.trim() || reason.length > 2000) throw new BudgetError('A bounded owner review explanation is required')
    this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM attempts WHERE attempt_id=? AND state='uncertain' AND receipt IS NOT NULL").get(attempt)
      if (!row || typeof row.receipt !== 'string' || requestDigest(row.receipt) !== receiptDigest || row.price_revision !== PRICE_REVISION) throw new BudgetError('Reviewed complete receipt identity or tariff differs')
      const control = record(this.db.prepare('SELECT blocked FROM control WHERE id=1').get())
      if (!control.blocked || control.blocked !== row.outcome) throw new BudgetError('Reviewed attempt does not explain the current admission block')
      if (this.db.prepare("SELECT attempt_id FROM attempts WHERE state='uncertain' AND receipt IS NOT NULL AND attempt_id!=?").get(attempt)) throw new BudgetError('Other retained complete receipts require independent review')
      const charge = receiptCharge(JSON.parse(row.receipt) as Receipt, Number(row.max_tokens), Number(row.reserved))
      const audit = JSON.stringify({ kind: 'reviewed_complete', reviewedAt: new Date().toISOString(), reason,
        previousOutcome: row.outcome, previousCharge: row.charged, receiptSha256: receiptDigest })
      this.db.prepare("UPDATE attempts SET charged=?, state='reconciled', outcome=? WHERE attempt_id=?").run(charge, audit, attempt)
      this.db.prepare('UPDATE control SET blocked=NULL WHERE id=1').run()
    })
  }
  /**
   * Retain the full reservation for an interrupted or unverifiable response.
   * @param attempt - committed physical attempt id.
   * @param outcome - bounded diagnostic without credentials.
   * @param block - whether evidence invalidates further admission.
   */
  uncertain(attempt: string, outcome: string, block = false): void {
    this.transaction(() => {
      this.db.prepare("UPDATE attempts SET state='uncertain', outcome=? WHERE attempt_id=? AND state='reserved'").run(outcome.slice(0, 1000), attempt)
      if (block) this.db.prepare('UPDATE control SET blocked=? WHERE id=1').run(outcome.slice(0, 1000))
    })
  }
  /** Release only the Host lease; unresolved reservations remain charged. */
  close(): void {
    if (this.closed) return
    this.transaction(() => {
      this.db.prepare("UPDATE attempts SET state='uncertain', outcome='Host stopped before settlement' WHERE host_id=? AND state='reserved'").run(this.hostId)
      this.db.prepare('DELETE FROM writer WHERE host_id=?').run(this.hostId)
    })
    this.db.close()
    this.closed = true
  }
}

/**
 * Hash exact request bytes without storing private prompt text in accounting.
 * @param payload - effective serialized Messages request.
 * @returns SHA-256 hex digest.
 */
export function requestDigest(payload: string): string { return createHash('sha256').update(payload).digest('hex') }
