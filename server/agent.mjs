import { policies, priorCases } from './data.mjs'
import { runProviderEnsemble } from './llm.mjs'

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))

export function similarity(a, b) {
  const one = new Set(a)
  const two = new Set(b)
  const intersection = [...one].filter((item) => two.has(item)).length
  const union = new Set([...one, ...two]).size
  return union ? intersection / union : 0
}

export function analyzeCase(fraudCase) {
  const indicators = new Set(fraudCase.indicators)
  const has = (...items) => items.every((item) => indicators.has(item))
  const patterns = []

  if (has('new_device', 'password_reset', 'new_beneficiary')) {
    patterns.push({ name: 'Account takeover', confidence: has('impossible_travel') ? 0.94 : 0.82, basis: 'Credential change followed by a novel device and beneficiary' })
  }
  if (indicators.has('mule_link') || indicators.has('fan_out')) {
    patterns.push({ name: 'Mule network movement', confidence: indicators.has('fan_out') ? 0.92 : 0.81, basis: 'Recipient proximity to known mule infrastructure' })
  }
  if (has('shared_device', 'velocity')) {
    patterns.push({ name: 'Coordinated account abuse', confidence: 0.74, basis: 'Shared device plus transaction velocity anomaly' })
  }

  const evidenceStrength = fraudCase.evidence.length
    ? fraudCase.evidence.reduce((sum, item) => sum + item.strength, 0) / fraudCase.evidence.length
    : 0.5
  const patternConfidence = patterns.length ? Math.max(...patterns.map((p) => p.confidence)) : 0.42
  const confidence = clamp(patternConfidence * 0.65 + evidenceStrength * 0.35)
  const risk = clamp((fraudCase.riskScore / 100) * 0.6 + patternConfidence * 0.3 + (indicators.has('mule_link') ? 0.1 : 0))

  const memory = priorCases
    .map((item) => ({ ...item, similarity: similarity(fraudCase.indicators, item.indicators) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)

  let recommendation
  if (confidence < 0.7) {
    recommendation = {
      action: 'Request step-up verification',
      actionCode: 'CUSTOMER_CHALLENGE',
      rationale: 'Risk is elevated, but the evidence is not strong enough for a restrictive action.',
      policy: policies.CUSTOMER_CHALLENGE,
      execution: 'May execute automatically',
      stop: false,
    }
  } else if (risk >= policies.OUTBOUND_RESTRICTION.threshold) {
    recommendation = {
      action: 'Temporarily restrict outbound transfers',
      actionCode: 'OUTBOUND_RESTRICTION',
      rationale: 'Converging identity, device, behavioral, and graph evidence indicates likely account takeover.',
      policy: policies.OUTBOUND_RESTRICTION,
      execution: 'Human approval required',
      stop: true,
    }
  } else {
    recommendation = {
      action: 'Allow and monitor',
      actionCode: 'MONITOR',
      rationale: 'Available evidence does not cross the intervention threshold.',
      policy: { id: 'FRD-1.4', title: 'Ongoing transaction monitoring', approval: 'No approval required', reversible: true },
      execution: 'May execute automatically',
      stop: true,
    }
  }

  return { risk, confidence, patterns, memory, recommendation }
}

export function createRun(fraudCase) {
  const analysis = fraudCase.assessment || analyzeCase(fraudCase)
  const nodeCount = fraudCase.graph?.nodes?.length || 8
  return {
    id: `RUN-${Date.now()}`,
    caseId: fraudCase.id,
    startedAt: new Date().toISOString(),
    analysis,
    steps: [
      { id: 'trigger', label: 'Trigger validated', tool: 'Risk signal', detail: `${fraudCase.trigger} scored ${fraudCase.riskScore}/100`, status: 'complete' },
      { id: 'graph', label: 'Graph context retrieved', tool: 'TigerGraph MCP', detail: `${nodeCount} relevant entities across 3 hops`, status: 'complete' },
      { id: 'pattern', label: 'Patterns evaluated', tool: 'GSQL + GraphRAG', detail: analysis.patterns.length ? `${analysis.patterns.length} fraud typologies matched` : 'No known typology passed threshold', status: 'complete' },
      { id: 'memory', label: 'Case memory searched', tool: 'Vector + graph search', detail: `${analysis.memory.length} resolved cases retrieved`, status: 'complete' },
      { id: 'policy', label: 'Policy guardrails applied', tool: 'Policy engine', detail: `${analysis.recommendation.policy.id} controls the action`, status: 'complete' },
      { id: 'decision', label: analysis.recommendation.stop ? 'Defensible action reached' : 'More evidence required', tool: 'Decision agent', detail: analysis.recommendation.action, status: 'complete' },
    ],
  }
}

export async function createAgenticRun(fraudCase, options) {
  const run = createRun(fraudCase)
  const llm = await runProviderEnsemble(fraudCase, run.analysis, options)
  const completed = llm.providers.filter((provider) => provider.status === 'complete').length
  const configured = llm.providers.filter((provider) => provider.status !== 'not_configured').length
  const selectedTools = llm.consensus.selectedTools?.map((tool) => tool.name) || []
  const ensembleStep = {
    id: 'ensemble',
    label: completed ? 'Evidence explained and tools selected' : 'Model advisory unavailable',
    tool: selectedTools.length ? `Allowlist: ${selectedTools.join(', ')}` : 'Multi-model ensemble',
    detail: completed
      ? `${completed}/${configured} providers responded · ${selectedTools.length} read-only tool(s) selected · ${Math.round(llm.consensus.fraudProbability * 100)}% median fraud probability`
      : configured
        ? `0/${configured} configured providers responded · deterministic baseline retained`
        : 'No providers configured · deterministic baseline retained',
    status: completed ? 'complete' : 'degraded',
  }
  const policyIndex = run.steps.findIndex((step) => step.id === 'policy')
  run.steps.splice(policyIndex, 0, ensembleStep)
  return { ...run, llm }
}
