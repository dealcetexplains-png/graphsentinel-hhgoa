const required = (env) => Boolean(
  env.TIGERGRAPH_HOST && env.TIGERGRAPH_GRAPH && env.TIGERGRAPH_TOKEN &&
  env.TIGERGRAPH_HOST !== 'https://your-instance.i.tgcloud.io' && env.TIGERGRAPH_TOKEN !== 'replace-me'
)

const trimHost = (value) => String(value || '').replace(/\/$/, '')

function authHeaders(env, extra = {}) {
  return { Authorization: `Bearer ${env.TIGERGRAPH_TOKEN}`, ...extra }
}

function assertTigerGraphResponse(response, data, operation) {
  if (!response.ok || data?.error === true) {
    throw new Error(`${operation} failed (${response.status || data?.code || 'unknown'})`)
  }
  return data
}

export function tigerGraphStatus(env = process.env) {
  const connected = required(env) && env.DEMO_MODE !== 'true'
  return {
    mode: connected ? 'live' : 'demo',
    graph: env.TIGERGRAPH_GRAPH || 'HHGOA local index',
    connected,
    writeback: connected && env.TIGERGRAPH_WRITEBACK !== 'false',
  }
}

export function buildContextUrl(transactionId, env = process.env) {
  const host = trimHost(env.TIGERGRAPH_HOST)
  const graph = encodeURIComponent(env.TIGERGRAPH_GRAPH)
  const query = encodeURIComponent(env.TIGERGRAPH_CONTEXT_QUERY || 'fraud_case_context')
  return `${host}/restpp/query/${graph}/${query}?transaction_id=${encodeURIComponent(transactionId)}`
}

export async function fetchCaseContext(transactionId, { fetchImpl = fetch, env = process.env } = {}) {
  if (!required(env) || env.DEMO_MODE === 'true') return null
  const response = await fetchImpl(buildContextUrl(transactionId, env), {
    headers: authHeaders(env),
    signal: AbortSignal.timeout(Number(env.TIGERGRAPH_TIMEOUT_MS || 10000)),
  })
  const data = await response.json().catch(() => ({}))
  return assertTigerGraphResponse(response, data, 'TigerGraph context query')
}

function attr(value) {
  return { value }
}

function addEdge(payload, sourceId, edgeType, targetType, targetId, attributes = {}) {
  payload.edges.InvestigationCase ||= {}
  payload.edges.InvestigationCase[sourceId] ||= {}
  payload.edges.InvestigationCase[sourceId][edgeType] ||= {}
  payload.edges.InvestigationCase[sourceId][edgeType][targetType] ||= {}
  payload.edges.InvestigationCase[sourceId][edgeType][targetType][targetId] = attributes
}

export function buildCaseWritebackPayload(answer, fallbackTransactionId = '', fallbackCardId = '') {
  if (!answer?.case_id || !answer.case) throw new Error('A valid HHGOA answer is required for graph writeback')
  const caseId = answer.case_id
  const item = answer.case
  const payload = {
    vertices: {
      InvestigationCase: {
        [caseId]: {
          status: attr(item.status || 'open'),
          verdict: attr(item.verdict || 'uncertain'),
          fraud_probability: attr(Number(item.fraud_probability || 0)),
          pattern: attr(item.pattern || 'none'),
          pattern_description: attr(item.pattern_description || ''),
          exposure_usd: attr(Number(item.exposure_usd || 0)),
          summary: attr(item.summary || ''),
          created_at: attr(new Date().toISOString().replace('T', ' ').slice(0, 19)),
        },
      },
    },
    edges: {},
  }

  const transactionIds = new Set([...(item.affected_txn_ids || []), fallbackTransactionId].filter(Boolean))
  for (const transactionId of transactionIds) addEdge(payload, caseId, 'INVOLVES', 'Transaction', String(transactionId))
  const subjectCards = new Set([
    fallbackCardId,
    ...(answer.sar?.subjects || []).filter((subject) => /-K\d+$/.test(subject)),
    ...(item.evidence || []).flatMap((evidence) => evidence.entity_ids || []).filter((entityId) => /-K\d+$/.test(entityId)),
  ].filter(Boolean))
  for (const cardId of subjectCards) addEdge(payload, caseId, 'ON_CARD', 'Card', String(cardId))
  for (const cardId of new Set([...(item.connected_card_ids || [])].filter(Boolean))) {
    addEdge(payload, caseId, 'CONNECTED_TO', 'Card', String(cardId), { reason: attr(`HHGOA ${item.pattern || 'investigation'} linkage`) })
  }
  for (const priorId of new Set([...(item.similar_prior_cases || [])].filter(Boolean))) {
    addEdge(payload, caseId, 'SIMILAR_TO', 'ClosedCase', String(priorId), { score: attr(0), shared_indicators: attr(item.pattern || '') })
  }
  return payload
}

export async function writeInvestigationCase(answer, fallbackTransactionId = '', { fetchImpl = fetch, env = process.env, cardId = '' } = {}) {
  if (!required(env) || env.DEMO_MODE === 'true' || env.TIGERGRAPH_WRITEBACK === 'false') return null
  const graph = encodeURIComponent(env.TIGERGRAPH_GRAPH)
  const url = `${trimHost(env.TIGERGRAPH_HOST)}/restpp/graph/${graph}?vertex_must_exist=true`
  const payload = buildCaseWritebackPayload(answer, fallbackTransactionId, cardId)
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: authHeaders(env, { 'Content-Type': 'application/json', 'gsql-atomic-level': 'atomic' }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(env.TIGERGRAPH_TIMEOUT_MS || 10000)),
  })
  const data = await response.json().catch(() => ({}))
  assertTigerGraphResponse(response, data, 'TigerGraph case writeback')
  return { graphCaseId: answer.case_id, response: data }
}
