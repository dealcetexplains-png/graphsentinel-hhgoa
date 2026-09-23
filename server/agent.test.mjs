import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCase, createRun, similarity } from './agent.mjs'
import { cases } from './data.mjs'

test('similarity uses Jaccard overlap', () => {
  assert.equal(similarity(['a', 'b'], ['b', 'c']), 1 / 3)
})

test('high confidence ATO is routed to human-approved restriction', () => {
  const result = analyzeCase(cases[0])
  assert.ok(result.confidence > 0.85)
  assert.ok(result.risk > 0.8)
  assert.equal(result.recommendation.actionCode, 'OUTBOUND_RESTRICTION')
  assert.equal(result.recommendation.execution, 'Human approval required')
})

test('run preserves an explainable, ordered trace', () => {
  const run = createRun(cases[0])
  assert.equal(run.steps.length, 6)
  assert.equal(run.steps.at(-1).id, 'decision')
  assert.ok(run.analysis.memory[0].similarity > 0.5)
})
