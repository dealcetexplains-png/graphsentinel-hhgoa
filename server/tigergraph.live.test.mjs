import './env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchCaseContext, writeInvestigationCase } from './tigergraph.mjs'

const enabled = process.env.TIGERGRAPH_LIVE_TEST === 'true'
const transactionId = process.env.TIGERGRAPH_TEST_TRANSACTION_ID

test('live TigerGraph context query returns a successful RESTPP envelope', { skip: !enabled }, async () => {
  assert.ok(transactionId, 'TIGERGRAPH_TEST_TRANSACTION_ID is required')
  const result = await fetchCaseContext(transactionId)
  assert.equal(result.error, false)
  assert.ok(Array.isArray(result.results))
})

test('live TigerGraph case writeback accepts an atomic case-memory upsert', { skip: !enabled }, async () => {
  assert.ok(transactionId, 'TIGERGRAPH_TEST_TRANSACTION_ID is required')
  const caseId = `TEST-LIVE-${Date.now()}`
  const result = await writeInvestigationCase({
    case_id: caseId,
    case: {
      status: 'open', verdict: 'uncertain', fraud_probability: 0.5, pattern: 'none', pattern_description: '',
      exposure_usd: 0, summary: 'Automated live integration-test writeback', affected_txn_ids: [transactionId],
      connected_card_ids: [], similar_prior_cases: [],
    },
  }, transactionId)
  assert.equal(result.graphCaseId, caseId)
})

