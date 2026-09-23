const ADVISORY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['fraud', 'legitimate', 'uncertain'] },
    fraud_probability: { type: 'number', minimum: 0, maximum: 1 },
    pattern: { type: 'string' },
    rationale: { type: 'string' },
    evidence_ids: { type: 'array', items: { type: 'string' } },
    recommended_actions: { type: 'array', items: { type: 'string' } },
    uncertainty: { type: 'string' },
    evidence_explanation: { type: 'string' },
    tool_plan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: ['fraud_case_context', 'card_window', 'device_neighbors', 'similar_resolved_cases', 'policy_lookup', 'answer_contract_check'] },
          reason: { type: 'string' },
        },
        required: ['name', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdict', 'fraud_probability', 'pattern', 'rationale', 'evidence_ids', 'recommended_actions', 'uncertainty', 'evidence_explanation', 'tool_plan'],
  additionalProperties: false,
}

const ALLOWED_VERDICTS = new Set(['fraud', 'legitimate', 'uncertain'])
const ALLOWED_TOOLS = new Set(['fraud_case_context', 'card_window', 'device_neighbors', 'similar_resolved_cases', 'policy_lookup', 'answer_contract_check'])
const PROVIDER_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 20000)

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function collectGeminiKeys(env = process.env) {
  return Object.entries(env)
    .map(([key, value]) => {
      const match = key.match(/^GEMINI_API_KEY(?:_(\d+))?$/)
      return match && value && value !== 'replace-me' ? { rank: Number(match[1] || 0), value } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.value)
}

export function parseJsonResponse(value) {
  if (value && typeof value === 'object') return value
  const text = String(value || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Model did not return a JSON object')
  return JSON.parse(text.slice(start, end + 1))
}

export function validateOpinion(input) {
  const value = parseJsonResponse(input)
  const verdict = ALLOWED_VERDICTS.has(value.verdict) ? value.verdict : 'uncertain'
  const probability = Number(value.fraud_probability)
  if (!Number.isFinite(probability)) throw new Error('Model response omitted fraud_probability')
  return {
    verdict,
    fraudProbability: Math.max(0, Math.min(1, probability)),
    pattern: clean(value.pattern, 120) || 'Unspecified pattern',
    rationale: clean(value.rationale, 700),
    evidenceIds: Array.isArray(value.evidence_ids) ? value.evidence_ids.map((item) => clean(item, 80)).filter(Boolean).slice(0, 12) : [],
    recommendedActions: Array.isArray(value.recommended_actions) ? value.recommended_actions.map((item) => clean(item, 140)).filter(Boolean).slice(0, 8) : [],
    uncertainty: clean(value.uncertainty, 300),
    evidenceExplanation: clean(value.evidence_explanation || value.rationale, 900),
    toolPlan: Array.isArray(value.tool_plan) ? value.tool_plan
      .filter((item) => item && ALLOWED_TOOLS.has(item.name))
      .map((item) => ({ name: item.name, reason: clean(item.reason, 240) }))
      .slice(0, 6) : [],
  }
}

export function buildPrompt(fraudCase, baseline) {
  const evidence = (fraudCase.evidence || []).map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    detail: clean(item.detail, 220),
    strength: item.strength,
  }))
  const graph = {
    nodes: (fraudCase.graph?.nodes || []).map(({ id, label, sublabel, kind, risk }) => ({ id, label, sublabel, kind, risk })),
    edges: (fraudCase.graph?.edges || []).map(({ from, to, label, suspicious }) => ({ from, to, label, suspicious: Boolean(suspicious) })),
  }
  return [
    'You are an advisory fraud-investigation reviewer for the HHGOA IEEE-CIS benchmark.',
    'Assess only the supplied evidence. Explain how the evidence supports or weakens the conclusion. Never claim an action was executed. Policy and human-approval controls are authoritative.',
    'Select additional tools only from: fraud_case_context, card_window, device_neighbors, similar_resolved_cases, policy_lookup, answer_contract_check. Tool selection is advisory and read-only; do not select action or policy-bypass tools.',
    'Return one JSON object only, matching the requested schema. Cite evidence using the supplied evidence IDs.',
    JSON.stringify({
      case: {
        id: fraudCase.id,
        transactionId: fraudCase.transactionId,
        trigger: fraudCase.trigger,
        amount: fraudCase.amount,
        currency: fraudCase.currency,
        riskScore: fraudCase.riskScore,
        summary: fraudCase.summary,
        indicators: fraudCase.indicators,
      },
      evidence,
      graph,
      deterministicBaseline: {
        risk: baseline.risk,
        confidence: baseline.confidence,
        patterns: baseline.patterns,
        recommendedAction: baseline.recommendation.action,
        policy: baseline.recommendation.policy,
      },
    }),
  ].join('\n\n')
}

function timeoutSignal() {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
}

async function requestJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, { ...options, signal: timeoutSignal() })
  if (!response.ok) {
    const error = new Error(`Provider returned HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

async function callGemini(prompt, fetchImpl, env) {
  const keys = collectGeminiKeys(env)
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash'
  let lastError
  for (let index = 0; index < keys.length; index += 1) {
    try {
      const data = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[index] },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json', responseJsonSchema: ADVISORY_SCHEMA },
        }),
      }, fetchImpl)
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')
      if (!String(text || '').trim()) {
        const error = new Error(`Gemini returned no text (${clean(data.candidates?.[0]?.finishReason || 'unknown', 60)})`)
        error.retryable = true
        throw error
      }
      try {
        return { opinion: validateOpinion(text), keySlot: index + 1 }
      } catch (error) {
        const malformed = new Error('Gemini returned malformed JSON')
        malformed.retryable = true
        throw malformed
      }
    } catch (error) {
      lastError = error
      if (![401, 403, 429, 500, 502, 503, 504].includes(error.status) && error.name !== 'TimeoutError' && !error.retryable) break
    }
  }
  throw lastError || new Error('No Gemini key is configured')
}

async function callOpenAICompatible({ url, key, model, prompt, headers = {}, responseFormat = { type: 'json_object' } }, fetchImpl) {
  const data = await requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 900,
      response_format: responseFormat,
      messages: [
        { role: 'system', content: 'Return strict JSON only. You are advisory; deterministic policy controls remain authoritative.' },
        { role: 'user', content: prompt },
      ],
    }),
  }, fetchImpl)
  return validateOpinion(data.choices?.[0]?.message?.content)
}

async function callMistral(prompt, fetchImpl, env) {
  const key = env.MISTRAL_API_KEY
  const agentId = env.SPIRIT_MISTRAL_AGENT_ID
  if (agentId) {
    try {
      const data = await requestJson('https://api.mistral.ai/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          agent_id: agentId,
          ...(env.SPIRIT_MISTRAL_AGENT_VERSION ? { agent_version: Number(env.SPIRIT_MISTRAL_AGENT_VERSION) } : {}),
          inputs: [{ role: 'user', content: prompt }],
          store: false,
          completion_args: { temperature: 0.1, max_tokens: 900, response_format: { type: 'json_object' } },
        }),
      }, fetchImpl)
      const output = [...(data.outputs || [])].reverse().find((item) => item.role === 'assistant')
      const content = Array.isArray(output?.content) ? output.content.map((item) => item.text || item.content || '').join('') : output?.content
      return validateOpinion(content)
    } catch (error) {
      if (![400, 404, 422].includes(error.status)) throw error
    }
  }
  return callOpenAICompatible({
    url: 'https://api.mistral.ai/v1/chat/completions',
    key,
    model: env.SPIRIT_MISTRAL_MODEL || 'mistral-small-latest',
    prompt,
  }, fetchImpl)
}

function providerDefinitions(env = process.env) {
  return [
    {
      id: 'gemini', label: 'Gemini', model: env.GEMINI_MODEL || 'gemini-2.5-flash', configured: collectGeminiKeys(env).length > 0,
      keyCount: collectGeminiKeys(env).length,
      run: (prompt, fetchImpl) => callGemini(prompt, fetchImpl, env),
    },
  ]
}

export function llmStatus(env = process.env) {
  const providers = providerDefinitions(env).map(({ id, label, model, configured, keyCount }) => ({ id, label, model, configured, ...(id === 'gemini' ? { keyCount } : {}) }))
  return {
    mode: 'gemini-key-failover',
    configured: providers.filter((provider) => provider.configured).length,
    total: providers.length,
    providers,
    guardrail: 'Model opinions cannot change policy routes, execute actions, or bypass human approval.',
  }
}

// A minimal read-only validation request. It deliberately reports key slots,
// not credentials, so it can be safely used before a demo.
export async function checkGeminiKeys({ fetchImpl = fetch, env = process.env } = {}) {
  const keys = collectGeminiKeys(env)
  const checks = await Promise.all(keys.map(async (key, index) => {
    try {
      const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': key }, signal: timeoutSignal(),
      })
      return { slot: index + 1, ok: response.ok, status: response.status }
    } catch (error) {
      return { slot: index + 1, ok: false, status: 0, error: clean(error?.message || 'Request failed', 120) }
    }
  }))
  return { configured: keys.length, valid: checks.filter((item) => item.ok).length, checks }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function synthesizeConsensus(results, baseline) {
  const opinions = results.filter((result) => result.status === 'complete' && result.opinion).map((result) => result.opinion)
  if (!opinions.length) return { available: false, responders: 0, verdict: 'unavailable', fraudProbability: null, agreement: null, pattern: 'Deterministic baseline retained', evidenceExplanation: 'No model opinion was available; the evidence ledger and deterministic assessment remain authoritative.', selectedTools: [] }
  const counts = opinions.reduce((map, opinion) => map.set(opinion.verdict, (map.get(opinion.verdict) || 0) + 1), new Map())
  const verdict = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const patternCounts = opinions.reduce((map, opinion) => map.set(opinion.pattern, (map.get(opinion.pattern) || 0) + 1), new Map())
  const pattern = [...patternCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const baselineVerdict = baseline.risk >= 0.7 ? 'fraud' : baseline.risk <= 0.3 ? 'legitimate' : 'uncertain'
  const toolVotes = new Map()
  for (const opinion of opinions) {
    for (const tool of opinion.toolPlan || []) {
      const current = toolVotes.get(tool.name) || { name: tool.name, reason: tool.reason, votes: 0 }
      current.votes += 1
      toolVotes.set(tool.name, current)
    }
  }
  const representative = [...opinions].sort((a, b) => b.fraudProbability - a.fraudProbability)[0]
  return {
    available: true,
    responders: opinions.length,
    verdict,
    fraudProbability: median(opinions.map((opinion) => opinion.fraudProbability)),
    agreement: opinions.filter((opinion) => opinion.verdict === baselineVerdict).length / opinions.length,
    pattern,
    evidenceExplanation: representative.evidenceExplanation || representative.rationale,
    selectedTools: [...toolVotes.values()].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name)),
  }
}

export async function runProviderEnsemble(fraudCase, baseline, { fetchImpl = fetch, env = process.env } = {}) {
  const prompt = buildPrompt(fraudCase, baseline)
  const definitions = providerDefinitions(env)
  const results = await Promise.all(definitions.map(async (provider) => {
    const base = { id: provider.id, label: provider.label, model: provider.model }
    if (!provider.configured) return { ...base, status: 'not_configured', latencyMs: 0 }
    const started = Date.now()
    try {
      const value = await provider.run(prompt, fetchImpl)
      const opinion = value?.opinion || value
      return { ...base, status: 'complete', latencyMs: Date.now() - started, opinion, ...(value?.keySlot ? { keySlot: value.keySlot } : {}) }
    } catch (error) {
      return { ...base, status: 'unavailable', latencyMs: Date.now() - started, error: clean(error?.message || 'Provider request failed', 180) }
    }
  }))
  return {
    mode: 'gemini-key-failover',
    guardrail: 'LLM opinions are advisory. The deterministic HHGOA policy engine controls routing and human approval.',
    consensus: synthesizeConsensus(results, baseline),
    providers: results,
  }
}
