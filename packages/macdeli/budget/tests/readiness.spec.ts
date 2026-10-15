/** A failed budget plugin must never admit its autonomous mission dependent. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import * as Budget from '../src/index.ts'

const state = vi.hoisted(() => ({ fail: true, closed: false }))
vi.mock('../src/ledger.ts', () => ({
  OUTPUT_LIMIT: 8192,
  BudgetLedger: class {
    constructor() { if (state.fail) throw new Error('authoritative ledger unavailable') }
    status() { return { budgetId: 'test-only' } }
    close() { state.closed = true }
  },
}))

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose(); state.fail = true; state.closed = false })

it('keeps mission pending on initialization failure and stops it when readiness is removed', async () => {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  let admitted = 0
  let stopped = false
  await ctx.plugin({ name: 'test-mission', inject: ['macdeliBudget'], apply(ctx: Context) {
    admitted++
    expect(ctx.macdeliBudget.ready).toBe(true)
    ctx.effect(() => () => { stopped = true })
  } })
  await expect(ctx.plugin(Budget)).rejects.toThrow('authoritative ledger unavailable')
  expect(admitted).toBe(0)
  expect(ctx.get('macdeliBudget')).toBeUndefined()
  ctx.registry.delete(Budget)
  state.fail = false
  const ready = await ctx.plugin(Budget)
  expect(admitted).toBe(1)
  await ready.dispose()
  expect(stopped).toBe(true)
  expect(state.closed).toBe(true)
  expect(ctx.get('macdeliBudget')).toBeUndefined()
})
