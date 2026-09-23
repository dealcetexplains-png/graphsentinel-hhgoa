export type Evidence = {
  id: string
  type: string
  title: string
  detail: string
  strength: number
  source: string
  icon: string
}

export type GraphNode = {
  id: string
  label: string
  sublabel: string
  kind: string
  x: number
  y: number
  risk: 'safe' | 'medium' | 'high'
}

export type GraphEdge = {
  from: string
  to: string
  label: string
  suspicious?: boolean
}

export type FraudCase = {
  id: string
  customer: string
  account: string
  trigger: string
  amount: number
  currency: string
  riskScore: number
  priorRiskScore: number
  status: string
  priority: string
  openedAt: string
  age: string
  owner: string
  transactionId: string
  summary: string
  indicators: string[]
  evidence: Evidence[]
  evidenceCount?: number
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
  audit?: AuditEntry[]
  assessment?: RunResult['analysis']
  answer?: HHGOAAnswer
}

export type HHGOAAction = { action: string; route: 'auto' | 'L1' | 'L2'; reason: string }

export type HHGOAAnswer = {
  case_id: string
  case: {
    status: string
    verdict: 'fraud' | 'legitimate' | 'uncertain'
    fraud_probability: number
    pattern: string
    pattern_description: string
    affected_txn_ids: string[]
    first_suspicious_txn_id: string
    connected_card_ids: string[]
    connected_device_profiles: string[]
    exposure_usd: number
    evidence: Array<{ claim: string; source: string; ref: string; entity_ids: string[] }>
    similar_prior_cases: string[]
    summary: string
    written_to_graph: boolean
    graph_case_id: string
  }
  evidence_requests: Array<{ type: string; asked_after_step: number; assumed_response: string }>
  next_best_actions: { initial: HHGOAAction[]; final: HHGOAAction[]; what_changed: string }
  sar: {
    file: boolean
    reason: string
    narrative: string
    subjects: string[]
    total_amount_usd: number
    activity_dates: string[]
  }
  stop_reason: string
  tool_calls: number
  tokens: number
  latency_s: number
}

export type AgentStep = {
  id: string
  label: string
  tool: string
  detail: string
  status: string
}

export type MemoryCase = {
  id: string
  outcome: string
  similarity: number
  indicators: string[]
  action: string
  lossPrevented: number
}

export type Recommendation = {
  action: string
  actionCode: string
  actions?: { action: string; actionCode: string; route: 'auto' | 'L1' | 'L2' }[]
  rationale: string
  execution: string
  stop: boolean
  policy: { id: string; title: string; approval: string; reversible: boolean }
}

export type RunResult = {
  id: string
  caseId: string
  startedAt: string
  graphMode: 'demo' | 'live'
  answer?: HHGOAAnswer
  steps: AgentStep[]
  analysis: {
    risk: number
    confidence: number
    patterns: { name: string; confidence: number; basis: string }[]
    memory: MemoryCase[]
    recommendation: Recommendation
  }
  llm?: {
    mode: 'advisory-ensemble'
    guardrail: string
    consensus: {
      available: boolean
      responders: number
      verdict: 'fraud' | 'legitimate' | 'uncertain' | 'unavailable'
      fraudProbability: number | null
      agreement: number | null
      pattern: string
      evidenceExplanation: string
      selectedTools: Array<{ name: string; reason: string; votes: number }>
    }
    providers: Array<{
      id: string
      label: string
      model: string
      status: 'complete' | 'unavailable' | 'not_configured'
      latencyMs: number
      keySlot?: number
      error?: string
      opinion?: {
        verdict: 'fraud' | 'legitimate' | 'uncertain'
        fraudProbability: number
        pattern: string
        rationale: string
        evidenceIds: string[]
        recommendedActions: string[]
        uncertainty: string
        evidenceExplanation: string
        toolPlan: Array<{ name: string; reason: string }>
      }
    }>
  }
}

export type AuditEntry = {
  id: string
  time: string
  actor: string
  event: string
  detail: string
}
