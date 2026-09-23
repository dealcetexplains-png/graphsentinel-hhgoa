import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCaseWritebackPayload, buildContextUrl, fetchCaseContext, writeInvestigationCase } from './tigergraph.mjs'

const env = {
  TIGERGRAPH_HOST: 'https://graph.example',
  TIGERGRAPH_GRAPH: 'Fraud Graph',
  TIGERGRAPH_TOKEN: 'test-token',
  TIGERGRAPH_CONTEXT_QUERY: 'fraud_case_context',
  DEMO_MODE: 'false',
}

const answer = {
  case_id: 'HHG-TEST',
  case: {
    status: 'closed_fraud', verdict: 'fraud', fraud_probability: 0.91, pattern: 'card_testing',
    pattern_description: '', exposure_usd: 220, summary: 'Test writeback', affected_txn_ids: ['TX-1'],
    connected_card_ids: ['CARD-2'], similar_prior_cases: ['CC-1'],
  },
}

test('live context query URL and authorization follow the RESTPP contract', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return { ok: true, status: 200, json: async () => ({ error: false, results: [{ seed: [] }] }) }
  }
  const result = await fetchCaseContext('TX 1', { fetchImpl, env })
  assert.equal(buildContextUrl('TX 1', env), 'https://graph.example/restpp/query/Fraud%20Graph/fraud_case_context?transaction_id=TX%201')
  assert.equal(request.options.headers.Authorization, 'Bearer test-token')
  assert.equal(result.error, false)
})

test('case writeback payload creates the case-memory vertex and governed edges', () => {
  const payload = buildCaseWritebackPayload(answer, 'TX-FALLBACK', 'CARD-1')
  assert.equal(payload.vertices.InvestigationCase['HHG-TEST'].verdict.value, 'fraud')
  assert.ok(payload.edges.InvestigationCase['HHG-TEST'].INVOLVES.Transaction['TX-1'])
  assert.ok(payload.edges.InvestigationCase['HHG-TEST'].INVOLVES.Transaction['TX-FALLBACK'])
  assert.ok(payload.edges.InvestigationCase['HHG-TEST'].ON_CARD.Card['CARD-1'])
  assert.equal(payload.edges.InvestigationCase['HHG-TEST'].CONNECTED_TO.Card['CARD-2'].reason.value.includes('card_testing'), true)
  assert.ok(payload.edges.InvestigationCase['HHG-TEST'].SIMILAR_TO.ClosedCase['CC-1'])
})

test('case writeback is atomic and never places the token in the URL', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return { ok: true, status: 200, json: async () => ({ error: false, results: [{ accepted_vertices: 1, accepted_edges: 4 }] }) }
  }
  const result = await writeInvestigationCase(answer, 'TX-FALLBACK', { fetchImpl, env })
  assert.equal(request.url, 'https://graph.example/restpp/graph/Fraud%20Graph?vertex_must_exist=true')
  assert.equal(request.url.includes('test-token'), false)
  assert.equal(request.options.headers['gsql-atomic-level'], 'atomic')
  assert.equal(JSON.parse(request.options.body).vertices.InvestigationCase['HHG-TEST'].status.value, 'closed_fraud')
  assert.equal(result.graphCaseId, 'HHG-TEST')
})

test('TigerGraph API errors are surfaced even when HTTP status is 200', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ error: true, code: 'REST-ERR' }) })
  await assert.rejects(() => fetchCaseContext('TX-1', { fetchImpl, env }), /failed/)
})
