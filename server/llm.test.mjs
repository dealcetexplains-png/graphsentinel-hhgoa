import test from 'node:test'
import assert from 'node:assert/strict'
import { checkGeminiKeys, collectGeminiKeys, llmStatus, parseJsonResponse, runProviderEnsemble, synthesizeConsensus } from './llm.mjs'
import { analyzeCase } from './agent.mjs'
import { cases } from './data.mjs'

const opinion = {
  verdict: 'fraud',
  fraud_probability: 0.91,
  pattern: 'Account takeover',
  rationale: 'The evidence converges on account takeover.',
  evidence_ids: ['EV-1'],
  recommended_actions: ['Require human review'],
  uncertainty: 'Device ownership is not independently verified.',
  evidence_explanation: 'The novel device and linked transaction history reinforce one another.',
  tool_plan: [
    { name: 'device_neighbors', reason: 'Check whether the device links unrelated cards.' },
    { name: 'execute_block_card', reason: 'This must never be accepted.' },
  ],
}

test('Gemini key pool is numerically ordered and never exposed by status', () => {
  const env = { GEMINI_API_KEY_10: 'slot-ten', GEMINI_API_KEY_2: 'slot-two', GEMINI_API_KEY_1: 'slot-one' }
  assert.deepEqual(collectGeminiKeys(env), ['slot-one', 'slot-two', 'slot-ten'])
  const status = llmStatus(env)
  assert.equal(status.providers[0].keyCount, 3)
  assert.equal(JSON.stringify(status).includes('slot-one'), false)
})

test('fenced model output is normalized to JSON', () => {
  assert.equal(parseJsonResponse(`\`\`\`json\n${JSON.stringify(opinion)}\n\`\`\``).verdict, 'fraud')
})

test('Gemini rotates to the next key after a rate-limit response', async () => {
  const usedKeys = []
  const fetchImpl = async (_url, options) => {
    usedKeys.push(options.headers['x-goog-api-key'])
    if (usedKeys.length === 1) return { ok: false, status: 429, json: async () => ({}) }
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(opinion) }] } }] }),
    }
  }
  const baseline = analyzeCase(cases[0])
  const result = await runProviderEnsemble(cases[0], baseline, {
    fetchImpl,
    env: { GEMINI_API_KEY_1: 'first-test-key', GEMINI_API_KEY_2: 'second-test-key' },
  })
  assert.deepEqual(usedKeys, ['first-test-key', 'second-test-key'])
  assert.equal(result.providers[0].status, 'complete')
  assert.equal(result.providers[0].keySlot, 2)
  assert.equal(result.consensus.verdict, 'fraud')
  assert.deepEqual(result.providers[0].opinion.toolPlan.map((tool) => tool.name), ['device_neighbors'])
  assert.equal(result.consensus.selectedTools[0].name, 'device_neighbors')
})

test('Gemini key health check reports slots without exposing credentials', async () => {
  const report = await checkGeminiKeys({
    env: { GEMINI_API_KEY_1: 'first-secret', GEMINI_API_KEY_2: 'second-secret' },
    fetchImpl: async (_url, options) => ({ ok: options.headers['x-goog-api-key'] === 'second-secret', status: options.headers['x-goog-api-key'] === 'second-secret' ? 200 : 403 }),
  })
  assert.deepEqual(report.checks.map(({ slot, ok, status }) => ({ slot, ok, status })), [{ slot: 1, ok: false, status: 403 }, { slot: 2, ok: true, status: 200 }])
  assert.equal(JSON.stringify(report).includes('secret'), false)
})

test('consensus uses the median probability and leaves policy assessment external', () => {
  const results = [
    { status: 'complete', opinion: { verdict: 'fraud', fraudProbability: 0.8, pattern: 'ATO' } },
    { status: 'complete', opinion: { verdict: 'fraud', fraudProbability: 0.9, pattern: 'ATO' } },
    { status: 'complete', opinion: { verdict: 'uncertain', fraudProbability: 0.4, pattern: 'Unknown' } },
  ]
  const consensus = synthesizeConsensus(results, { risk: 0.85 })
  assert.equal(consensus.fraudProbability, 0.8)
  assert.equal(consensus.verdict, 'fraud')
  assert.equal(consensus.agreement, 2 / 3)
})
