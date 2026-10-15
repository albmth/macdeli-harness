/** Exact-wire accounting middleware, shared by the Host and deterministic fixtures. */
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { DeepSeekPhysicalAttempt } from '@deepseek-ai/dsh-llm-deepseek'
import { BudgetError, BudgetLedger, OUTPUT_LIMIT, requestDigest } from './ledger.ts'

function blocked(message: string): LlmError { return new LlmError(message, 'MACDELI_BUDGET_BLOCKED') }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw blocked('Invalid serialized request object')
  return value as Record<string, unknown>
}
function effectiveLimit(request: DeepSeekPhysicalAttempt): number {
  if (request.endpoint !== 'https://api.deepseek.com/anthropic/v1/messages') throw blocked('Unapproved paid endpoint')
  if (request.options.provider !== 'deepseek-official' || request.options.model !== 'deepseek-flash') throw blocked('Unapproved paid provider/model')
  const body = object(JSON.parse(request.payload))
  const allowed = new Set(['model', 'stream', 'max_tokens', 'messages', 'system', 'thinking', 'output_config', 'temperature', 'stop_sequences', 'tools'])
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw blocked(`Unapproved request extension: ${key}`)
  if (body.model !== 'deepseek-flash' || body.stream !== true || typeof body.max_tokens !== 'number'
    || !Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > OUTPUT_LIMIT) throw blocked('Serialized model/output limits are not approved')
  if (object(body.thinking).type !== 'enabled' || object(body.output_config).effort !== 'low') throw blocked('Approved thinking configuration is required')
  if (!Array.isArray(body.messages)) throw blocked('Missing serialized messages')
  for (const message of body.messages) {
    const blocks = object(message).content
    if (!Array.isArray(blocks)) throw blocked('Invalid serialized content')
    for (const block of blocks) {
      const value = object(block)
      if (!['text', 'thinking', 'tool_use', 'tool_result'].includes(String(value.type))) throw blocked('Only text and ordinary tool messages are authorized')
      if (value.type === 'tool_result') {
        if (!Array.isArray(value.content) || value.content.some(part => object(part).type !== 'text')) throw blocked('Only text tool results are authorized')
      }
    }
  }
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => 'type' in object(tool)))) throw blocked('Provider-native paid tools are disabled')
  return body.max_tokens
}

/**
 * Gate one physical POST after defaults, serialization and extensions resolve.
 * @param ledger - shared cumulative Host ledger.
 * @param request - effective endpoint/body and request attribution.
 * @param next - dispatch this exact POST once.
 * @returns unchanged provider chunks after trustworthy settlement.
 */
export async function* guardedAttempt(ledger: BudgetLedger, request: DeepSeekPhysicalAttempt,
  next: () => AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk> {
  let attempt: string
  try {
    const maxTokens = effectiveLimit(request)
    request.options.signal?.throwIfAborted()
    attempt = ledger.reserve({ requestDigest: requestDigest(request.payload),
      sessionId: request.options.sessionId === undefined ? null : String(request.options.sessionId),
      purpose: request.options.purpose ?? 'agent', model: 'deepseek-flash', maxTokens })
  } catch (error) {
    if (error instanceof BudgetError) throw blocked(error.message)
    throw error
  }
  let settled = false
  try {
    for await (const chunk of next()) {
      if (chunk.type === 'finish' && ['stop', 'tool-calls', 'max-tokens'].includes(chunk.reason.kind)) {
        if (!request.receipt) {
          ledger.uncertain(attempt, 'Complete response lacks authoritative model/usage receipt', true)
          settled = true
          throw blocked('Complete response lacks authoritative model/usage receipt')
        }
        ledger.reconcile(attempt, request.receipt)
        settled = true
      }
      yield chunk
    }
  } catch (error) {
    const malformed = error instanceof LlmError && ['MALFORMED_RESPONSE', 'UNSUPPORTED_CONTENT'].includes(error.code)
    if (!settled) {
      ledger.uncertain(attempt, malformed ? 'Provider response has invalid usage or content' : 'Physical attempt failed or was interrupted', malformed)
      settled = true
    }
    if (error instanceof BudgetError || malformed) throw blocked(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    if (!settled) ledger.uncertain(attempt, 'Physical response did not complete; full reservation retained')
  }
}
