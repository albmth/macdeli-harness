/** Mandatory cumulative-budget middleware for the trusted MacDeli Host. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { contentHasFile, contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-deepseek'
import { BudgetLedger, OUTPUT_LIMIT } from './ledger.ts'
import { guardedAttempt } from './gate.ts'

/** Available only while the authoritative ledger and physical request hooks are installed. */
export interface MacdeliBudget {
  readonly ready: true
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    macdeliBudget: MacdeliBudget
  }
}

export const name = 'macdeli-budget'
export const inject = ['llm']
/** The deployment identity and cap are fixed outside session/profile configuration. */
export interface Config {}
export const Config = z.object({})

/**
 * Install fail-closed route admission and exact physical-attempt accounting.
 * @param ctx - trusted Host plugin context.
 */
export function apply(ctx: Context): void {
  const ledger = new BudgetLedger()
  ctx.effect(() => () => { ledger.close() })
  ctx.on('llm/stream', async function* (options, next) {
    if (options.provider !== 'deepseek-official' || options.model !== 'deepseek-flash') throw new LlmError('Only the approved DeepSeek route is authorized', 'MACDELI_BUDGET_BLOCKED')
    if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1 || options.maxTokens > OUTPUT_LIMIT)) throw new LlmError('Requested output exceeds the authorized cap', 'MACDELI_BUDGET_BLOCKED')
    if (options.messages.some(message => contentHasImage(message.content) || contentHasFile(message.content))) throw new LlmError('Paid Files and image input are disabled', 'MACDELI_BUDGET_BLOCKED')
    yield* next()
  })
  ctx.on('deepseek/physical-attempt', (request, next) => guardedAttempt(ledger, request, next))
  // Dependents cannot become active if ledger construction or hook installation failed.
  // Removing this service also deactivates dependent mission fibers.
  ctx.provide('macdeliBudget', Object.freeze({ ready: true as const }))
}
