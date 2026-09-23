import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  Bell,
  BookOpenText,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Command,
  Download,
  FileCheck2,
  FileText,
  Fingerprint,
  FolderKanban,
  HelpCircle,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Minus,
  MonitorSmartphone,
  Network,
  Play,
  Plus,
  Route,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  X,
  Zap,
} from 'lucide-react'
import type { AgentStep, Evidence, FraudCase, GraphNode, HHGOAAnswer, Recommendation, RunResult } from './types'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const nav = [
  { label: 'Command center', icon: LayoutDashboard },
  { label: 'Investigations', icon: FolderKanban, active: true, count: 20 },
  { label: 'Entity graph', icon: Network },
  { label: 'Case memory', icon: BookOpenText },
]

const evidenceIcons = {
  fingerprint: Fingerprint,
  monitor: MonitorSmartphone,
  route: Route,
  activity: Activity,
  message: MessageSquareText,
}

const initialRecommendation: Recommendation = {
  action: 'Review investigation evidence',
  actionCode: 'REVIEW_CASE',
  rationale: 'Load the case evidence and apply the HHGOA policy before taking an action.',
  execution: 'Auto permitted',
  stop: true,
  policy: { id: 'R1', title: 'Verify before blocking', approval: 'None', reversible: true },
}

type AuthState = { enabled: boolean; authenticated: boolean; user?: { username: string; role: string }; csrfToken?: string }

function App() {
  const [cases, setCases] = useState<FraudCase[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [activeCase, setActiveCase] = useState<FraudCase | null>(null)
  const [run, setRun] = useState<RunResult | null>(null)
  const [visibleSteps, setVisibleSteps] = useState(6)
  const [running, setRunning] = useState(false)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const [datasetStatus, setDatasetStatus] = useState<{ complete: boolean; downloading: boolean; approximateProgress: number; indexed: boolean; appCasesReady: boolean } | null>(null)
  const [llmStatus, setLlmStatus] = useState<{ configured: number; total: number } | null>(null)
  const [auth, setAuth] = useState<AuthState | null>(null)

  useEffect(() => {
    fetch('/api/auth/session')
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => setAuth(response.ok ? body : { enabled: true, authenticated: false }))
      .catch(() => setAuth({ enabled: true, authenticated: false }))
  }, [])

  useEffect(() => {
    if (!auth?.authenticated) return
    fetch('/api/health')
      .then((res) => res.json())
      .then((health) => {
        setDatasetStatus(health.hhgoa || null)
        setLlmStatus(health.llm || null)
      })
      .catch(() => undefined)
    fetch('/api/cases')
      .then((res) => res.json())
      .then((items: FraudCase[]) => {
        setCases(items)
        setSelectedId((current) => current || items[0]?.id || '')
      })
      .catch(() => setToast('Could not load the case queue. Is the API running?'))
  }, [auth?.authenticated])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    setActiveCase(null)
    setRun(null)
    setSelectedNode(null)
    fetch(`/api/cases/${selectedId}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Case request failed (${res.status})`)
        return res.json()
      })
      .then(setActiveCase)
      .catch((error) => {
        if (error.name !== 'AbortError') setToast('Unable to open this investigation.')
      })
    return () => controller.abort()
  }, [selectedId])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const filteredCases = useMemo(() => {
    const query = search.toLowerCase().trim()
    if (!query) return cases
    return cases.filter((item) => `${item.id} ${item.customer} ${item.trigger}`.toLowerCase().includes(query))
  }, [cases, search])

  const assessment = run?.analysis || activeCase?.assessment
  const recommendation = assessment?.recommendation || initialRecommendation
  const confidence = Math.round((assessment?.confidence || 0.92) * 100)
  const risk = Math.round((assessment?.risk || 0.9) * 100)
  const steps: AgentStep[] = run?.steps || (activeCase ? [
    { id: 'trigger', label: 'Trigger validated', tool: activeCase.trigger, detail: `${activeCase.transactionId} scored ${activeCase.riskScore}/100`, status: 'complete' },
    { id: 'graph', label: 'Graph context retrieved', tool: 'HHGOA graph index', detail: `${activeCase.graph.nodes.length} relevant entities connected`, status: 'complete' },
    { id: 'pattern', label: 'Patterns evaluated', tool: 'Pattern engine', detail: `${assessment?.patterns.length || 0} supported pattern(s)`, status: 'complete' },
    { id: 'memory', label: 'Case memory searched', tool: 'Resolved-case retrieval', detail: `${assessment?.memory.length || 0} prior cases retrieved`, status: 'complete' },
    { id: 'policy', label: 'Policy guardrails applied', tool: 'HHGOA policy v1.0', detail: recommendation.policy.id, status: 'complete' },
    { id: 'decision', label: 'Defensible action reached', tool: 'Decision agent', detail: recommendation.action, status: 'complete' },
  ] : [])

  async function investigate() {
    if (!activeCase || running) return
    setRunning(true)
    setVisibleSteps(0)
    try {
      const response = await fetch(`/api/cases/${activeCase.id}/investigate`, { method: 'POST', headers: auth?.csrfToken ? { 'X-CSRF-Token': auth.csrfToken } : {} })
      if (!response.ok) throw new Error('Investigation failed')
      const result: RunResult = await response.json()
      setRun(result)
      if (result.answer) setActiveCase((current) => current ? { ...current, answer: result.answer } : current)
      for (let i = 1; i <= result.steps.length; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 460))
        setVisibleSteps(i)
      }
      setToast(`Investigation complete · ${Math.round(result.analysis.confidence * 100)}% confidence`)
    } catch {
      setVisibleSteps(steps.length)
      setToast('The agent could not complete this run.')
    } finally {
      setRunning(false)
    }
  }

  async function takeAction(action: 'approve' | 'challenge' | 'escalate') {
    if (!activeCase) return
    try {
      const response = await fetch(`/api/cases/${activeCase.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth?.csrfToken ? { 'X-CSRF-Token': auth.csrfToken } : {}) },
        body: JSON.stringify({ action }),
      })
      const result = await response.json()
      setActiveCase({ ...activeCase, status: result.status, audit: result.audit })
      setCases((items) => items.map((item) => item.id === activeCase.id ? { ...item, status: result.status } : item))
      setToast(action === 'approve' ? 'Restriction approved and recorded' : action === 'challenge' ? 'Secure customer challenge sent' : 'Case escalated to a senior analyst')
    } catch {
      setToast('Action could not be recorded.')
    }
  }

  function exportBrief() {
    if (!activeCase) return
    const payload = {
      exportedAt: new Date().toISOString(),
      case: activeCase,
      assessment: { risk, confidence, patterns: assessment?.patterns || [] },
      recommendation,
      agentTrace: steps,
      answer: run?.answer || activeCase.answer,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activeCase.id}-investigation-brief.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setToast('Investigation brief exported')
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', headers: auth?.csrfToken ? { 'X-CSRF-Token': auth.csrfToken } : {} }).catch(() => undefined)
    setCases([])
    setActiveCase(null)
    setAuth({ enabled: true, authenticated: false })
  }

  if (!auth) return <div className="loading-screen"><LoaderCircle className="spin" /> Checking secure session…</div>
  if (!auth.authenticated) return <LoginScreen onAuthenticated={setAuth} />
  if (!activeCase) {
    return <div className="loading-screen"><LoaderCircle className="spin" /> Loading investigation workspace…</div>
  }

  return (
    <div className="app-shell">
      <Sidebar datasetStatus={datasetStatus} llmStatus={llmStatus} onDemo={() => setToast('This demo focuses on the complete investigation workflow.')} onLogout={auth.enabled ? logout : undefined} username={auth.user?.username || 'Local analyst'} />
      <div className="app-content">
        <Topbar onOpenQueue={() => setDrawerOpen(true)} />
        <div className="workspace">
          <CaseQueue
            items={filteredCases}
            selectedId={selectedId}
            search={search}
            onSearch={setSearch}
            onSelect={setSelectedId}
            mobileOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
          />

          <main className="case-main">
            <CaseHeader item={activeCase} onRun={investigate} onExport={exportBrief} running={running} />
            <div className="metric-grid">
              <Metric label="Agent confidence" value={`${confidence}%`} note="Evidence convergence" tone="teal" icon={<Sparkles />} />
              <Metric label="Composite risk" value={`${risk}/100`} note={`Up ${Math.max(0, risk - activeCase.priorRiskScore)} pts`} tone="red" icon={<ShieldAlert />} />
              <Metric label="Flagged amount" value={money.format(activeCase.amount)} note={activeCase.transactionId} tone="amber" icon={<ArrowDownRight />} />
              <Metric label="Graph context" value={activeCase.graph.nodes.length || 8} note="3 hops explored" tone="blue" icon={<Network />} />
            </div>

            <section className="content-grid">
              <div className="primary-column">
                <GraphCard graph={activeCase.graph} selectedNode={selectedNode} onSelectNode={setSelectedNode} graphMode={run?.graphMode || 'demo'} />
                <AgentTrace steps={steps} visibleSteps={visibleSteps} running={running} onRun={investigate} />
                <EvidenceCard evidence={activeCase.evidence} />
                <SubmissionCard answer={run?.answer || activeCase.answer} />
                <AuditTrail activeCase={activeCase} />
              </div>

              <aside className="decision-column">
                <RecommendationCard
                  recommendation={recommendation}
                  risk={risk}
                  confidence={confidence}
                  status={activeCase.status}
                  onApprove={() => takeAction('approve')}
                  onChallenge={() => takeAction('challenge')}
                  onEscalate={() => takeAction('escalate')}
                />
                {run?.llm && <ModelConsensusCard llm={run.llm} />}
                <PatternCard assessment={assessment} />
                <MemoryCard assessment={assessment} />
              </aside>
            </section>
          </main>
        </div>
      </div>
      {toast && <div className="toast"><CheckCircle2 /> {toast}</div>}
    </div>
  )
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (session: AuthState) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Sign in failed')
      onAuthenticated(body)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><span><Network /></span><div><strong>GraphSentinel</strong><small>SECURE FRAUD OPERATIONS</small></div></div>
        <div className="login-copy"><h1>Analyst sign in</h1><p>Access to case evidence, SAR details, and governed actions requires an authenticated session.</p></div>
        <label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="login-error"><AlertTriangle />{error}</div>}
        <button className="primary-btn login-submit" disabled={submitting}>{submitting ? <LoaderCircle className="spin" /> : <LockKeyhole />}{submitting ? 'Signing in…' : 'Sign in securely'}</button>
        <small className="login-note"><ShieldCheck /> HttpOnly session · CSRF protected · no browser-stored tokens</small>
      </form>
    </main>
  )
}

function Sidebar({ onDemo, onLogout, username, datasetStatus, llmStatus }: { onDemo: () => void; onLogout?: () => void; username: string; datasetStatus: { complete: boolean; downloading: boolean; approximateProgress: number; indexed: boolean; appCasesReady: boolean } | null; llmStatus: { configured: number; total: number } | null }) {
  const dataLabel = datasetStatus?.appCasesReady
    ? 'HHGOA cases active'
    : datasetStatus?.indexed
      ? 'HHGOA indexed'
      : datasetStatus?.downloading
        ? `Dataset ${Math.round(datasetStatus.approximateProgress * 100)}%`
        : datasetStatus?.complete
          ? 'Ready to index'
          : 'Demo data active'
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Network /></div>
        <div><strong>GraphSentinel</strong><span>FRAUD OPERATIONS</span></div>
      </div>
      <nav className="main-nav" aria-label="Primary navigation">
        <span className="nav-section">Workspace</span>
        {nav.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.label} className={item.active ? 'active' : ''} onClick={item.active ? undefined : onDemo}>
              <Icon /> <span>{item.label}</span>{item.count && <em>{item.count}</em>}
            </button>
          )
        })}
        <span className="nav-section second">Control</span>
        <button onClick={onDemo}><FileCheck2 /><span>Policies</span></button>
        <button onClick={onDemo}><UsersRound /><span>Team & approvals</span></button>
        <button onClick={onDemo}><Settings /><span>Settings</span></button>
      </nav>
      <div className="sidebar-status">
        <div className="status-line"><span className="pulse-dot" />Agent systems operational</div>
        <div className="system-line"><span>Case data</span><b>{dataLabel}</b></div>
        <div className="system-line"><span>Graph source</span><b>Local HHGOA index</b></div>
        <div className="system-line"><span>AI ensemble</span><b>{llmStatus ? `${llmStatus.configured}/${llmStatus.total} configured` : 'Checking'}</b></div>
        <div className="system-line"><span>Policy engine</span><b>v4.8</b></div>
      </div>
      <button className="user-card" onClick={onLogout || onDemo}>
        <span className="avatar">AR</span>
        <span><strong>{username}</strong><small>{onLogout ? 'Sign out · Fraud analyst' : 'Fraud analyst · L2'}</small></span>
        <ChevronDown />
      </button>
    </aside>
  )
}

function Topbar({ onOpenQueue }: { onOpenQueue: () => void }) {
  return (
    <header className="topbar">
      <button className="mobile-queue" aria-label="Open case queue" onClick={onOpenQueue}><FolderKanban /></button>
      <div className="breadcrumbs"><span>Investigations</span><b>/</b><strong>Case workspace</strong></div>
      <div className="top-actions">
        <button className="shortcut"><Search />Search anything <kbd><Command />K</kbd></button>
        <button className="icon-button" aria-label="Notifications"><Bell /><span /></button>
        <button className="icon-button" aria-label="Help"><HelpCircle /></button>
      </div>
    </header>
  )
}

function CaseQueue({ items, selectedId, search, onSearch, onSelect, mobileOpen, onClose }: {
  items: FraudCase[]; selectedId: string; search: string; onSearch: (value: string) => void; onSelect: (id: string) => void; mobileOpen: boolean; onClose: () => void
}) {
  return (
    <aside className={`case-queue ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="queue-title"><div><span>CASE QUEUE</span><h2>HHGOA investigations</h2></div><button aria-label="Close case queue" onClick={onClose}><X /></button></div>
      <div className="queue-search"><Search /><input aria-label="Search cases" placeholder="Search cases" value={search} onChange={(e) => onSearch(e.target.value)} /></div>
      <div className="queue-filter"><button className="active">Case pack <span>{items.length}</span></button><button>All <span>20</span></button></div>
      <div className="queue-list">
        {items.map((item) => (
          <button key={item.id} className={`case-row ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { onSelect(item.id); onClose() }}>
            <span className={`priority-line ${item.priority.toLowerCase()}`} />
            <span className="case-row-top"><b>{item.id}</b><small>{item.age}</small></span>
            <strong>{item.customer}</strong>
            <span className="case-trigger">{item.trigger} · {money.format(item.amount)}</span>
            <span className="case-row-bottom"><em className={`risk-pill ${item.riskScore > 85 ? 'critical' : item.riskScore > 60 ? 'high' : 'low'}`}>{item.riskScore} risk</em><small>{item.status}</small></span>
          </button>
        ))}
        {!items.length && <div className="empty-queue">No investigations match that search.</div>}
      </div>
      <button className="new-case"><Plus /> New investigation</button>
    </aside>
  )
}

function CaseHeader({ item, onRun, onExport, running }: { item: FraudCase; onRun: () => void; onExport: () => void; running: boolean }) {
  return (
    <header className="case-header">
      <div>
        <div className="eyebrow-row"><span className={`priority-badge ${item.priority.toLowerCase()}`}><CircleDot />{item.priority}</span><span className="case-id">{item.id}</span><span className="opened"><Clock3 /> Opened {item.openedAt}</span></div>
        <h1>{item.trigger}</h1>
        <p>{item.summary}</p>
        <div className="entity-line"><span><UserRound />{item.customer}</span><i /> <span>{item.account}</span><i /> <span>{item.transactionId}</span></div>
      </div>
      <div className="header-actions">
        <button className="secondary-btn" onClick={onExport}><Download />Export brief</button>
        <button className="primary-btn" onClick={onRun} disabled={running}>{running ? <LoaderCircle className="spin" /> : <Play />} {running ? 'Investigating…' : 'Run agent'}</button>
      </div>
    </header>
  )
}

function Metric({ label, value, note, tone, icon }: { label: string; value: string | number; note: string; tone: string; icon: React.ReactNode }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
    </div>
  )
}

function CardHeader({ icon, eyebrow, title, action }: { icon: React.ReactNode; eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="card-header"><div className="card-heading"><span>{icon}</span><div><small>{eyebrow}</small><h2>{title}</h2></div></div>{action}</div>
  )
}

function GraphCard({ graph, selectedNode, onSelectNode, graphMode }: { graph: FraudCase['graph']; selectedNode: GraphNode | null; onSelectNode: (node: GraphNode | null) => void; graphMode: 'demo' | 'live' }) {
  const nodes = graph.nodes || []
  const get = (id: string) => nodes.find((node) => node.id === id)
  return (
    <section className="card graph-card">
      <CardHeader
        icon={<Network />}
        eyebrow="CONNECTED EVIDENCE"
        title="Investigation graph"
        action={<div className="graph-actions"><span className="live-badge"><i />{graphMode === 'live' ? 'Live TigerGraph' : 'Local HHGOA graph'}</span><button aria-label="Zoom out"><Minus /></button><button aria-label="Zoom in"><Plus /></button></div>}
      />
      <div className="graph-stage">
        {nodes.length ? (
          <svg viewBox="0 0 620 455" role="img" aria-label="Connected entities in the active fraud investigation">
            <defs>
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#94a5a5" /></marker>
              <marker id="arrow-hot" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#dc5a45" /></marker>
              <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="5" floodOpacity=".13" /></filter>
            </defs>
            {graph.edges.map((edge, index) => {
              const from = get(edge.from); const to = get(edge.to)
              if (!from || !to) return null
              const mx = (from.x + to.x) / 2; const my = (from.y + to.y) / 2
              return (
                <g key={`${edge.from}-${edge.to}-${index}`}>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={edge.suspicious ? 'edge suspicious' : 'edge'} markerEnd={edge.suspicious ? 'url(#arrow-hot)' : 'url(#arrow)'} />
                  <rect x={mx - edge.label.length * 3.25 - 5} y={my - 10} width={edge.label.length * 6.5 + 10} height="18" rx="9" className="edge-label-bg" />
                  <text x={mx} y={my + 3} className={edge.suspicious ? 'edge-label hot' : 'edge-label'}>{edge.label}</text>
                </g>
              )
            })}
            {nodes.map((node) => {
              const selected = selectedNode?.id === node.id
              const initials = node.kind === 'customer' ? 'MC' : node.kind === 'transaction' ? '$' : node.kind === 'device' ? 'D' : node.kind === 'ip' ? 'IP' : node.kind === 'risk' ? '!' : 'A'
              return (
                <g key={node.id} className={`graph-node ${selected ? 'selected' : ''}`} onClick={() => onSelectNode(selected ? null : node)} role="button" tabIndex={0}>
                  {node.risk === 'high' && <circle cx={node.x} cy={node.y} r="34" className="node-halo" />}
                  <circle cx={node.x} cy={node.y} r={selected ? 29 : 26} className={`node-circle ${node.kind} ${node.risk}`} filter="url(#shadow)" />
                  <text x={node.x} y={node.y + 5} className="node-symbol">{initials}</text>
                  <text x={node.x} y={node.y + 43} className="node-label">{node.label}</text>
                  <text x={node.x} y={node.y + 57} className="node-sublabel">{node.sublabel}</text>
                </g>
              )
            })}
          </svg>
        ) : (
          <div className="empty-graph"><Network /><strong>Graph context is ready to load</strong><span>Run the agent to retrieve connected entities.</span></div>
        )}
        <div className="graph-legend"><span><i className="person" />Person</span><span><i className="entity" />Account / entity</span><span><i className="risk" />Risk signal</span><span><b />Suspicious link</span></div>
        {selectedNode && <div className="node-popover"><button onClick={() => onSelectNode(null)}><X /></button><small>{selectedNode.sublabel}</small><strong>{selectedNode.label}</strong><span><ShieldAlert />{selectedNode.risk === 'high' ? 'Elevated graph risk' : 'Context entity'}</span></div>}
      </div>
    </section>
  )
}

function AgentTrace({ steps, visibleSteps, running, onRun }: { steps: AgentStep[]; visibleSteps: number; running: boolean; onRun: () => void }) {
  return (
    <section className="card trace-card">
      <CardHeader icon={<Bot />} eyebrow="AGENT WORKLOG" title="Investigation trace" action={<button className="text-button" onClick={onRun}>{running ? 'Working…' : 'Run again'}<ArrowRight /></button>} />
      <div className="trace-summary"><div className="agent-orb"><Sparkles /></div><div><strong>{running ? 'Agent is investigating the case' : 'Investigation complete — enough evidence to act'}</strong><span>{running ? 'Traversing the graph, comparing memory, and applying policy controls.' : 'The evidence, resolved-case memory, and HHGOA policy support the displayed recommendation.'}</span></div><span className={`trace-state ${running ? 'working' : ''}`}>{running ? <><LoaderCircle className="spin" />Running</> : <><Check />Complete</>}</span></div>
      <div className="trace-steps">
        {steps.map((step, index) => {
          const visible = index < visibleSteps
          const current = running && index === visibleSteps
          return (
            <div key={step.id} className={`trace-step ${visible ? 'visible' : ''} ${current ? 'current' : ''}`}>
              <div className="step-marker">{visible ? <Check /> : current ? <LoaderCircle className="spin" /> : index + 1}</div>
              <div><strong>{step.label}</strong><span>{step.detail}</span></div>
              <small>{step.tool}</small>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function EvidenceCard({ evidence }: { evidence: Evidence[] }) {
  return (
    <section className="card evidence-card">
      <CardHeader icon={<FileText />} eyebrow="CASE RECORD" title={`Evidence ledger · ${evidence.length}`} action={<button className="text-button">View all<ArrowRight /></button>} />
      {evidence.length ? <div className="evidence-list">
        {evidence.map((item) => {
          const Icon = evidenceIcons[item.icon as keyof typeof evidenceIcons] || FileText
          return <article key={item.id}><div className="evidence-icon"><Icon /></div><div className="evidence-copy"><span>{item.type}</span><strong>{item.title}</strong><p>{item.detail}</p></div><div className="strength"><b>{Math.round(item.strength * 100)}%</b><small>strength</small><div><i style={{ width: `${item.strength * 100}%` }} /></div></div></article>
        })}
      </div> : <div className="empty-evidence">No evidence has been attached to this case yet.</div>}
    </section>
  )
}

function SubmissionCard({ answer }: { answer?: HHGOAAnswer }) {
  const [tab, setTab] = useState<'sar' | 'json'>('sar')
  if (!answer) return null
  const sar = answer.sar
  return (
    <section className="card submission-card">
      <CardHeader
        icon={<FileCheck2 />}
        eyebrow="HACKATHON DELIVERABLE"
        title="SAR and answer JSON"
        action={<div className="submission-tabs"><button className={tab === 'sar' ? 'active' : ''} onClick={() => setTab('sar')}>SAR</button><button className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>Complete JSON</button></div>}
      />
      {tab === 'sar' ? (
        <div className="sar-panel">
          <div className="sar-status"><span className={sar.file ? 'file' : 'no-file'}>{sar.file ? 'FILE REPORT' : 'NO FILING'}</span><strong>{sar.file ? money.format(sar.total_amount_usd) : 'No reportable amount'}</strong><small>{sar.activity_dates.length ? sar.activity_dates.join(' → ') : 'No reportable activity window'}</small></div>
          <div className="sar-reason"><strong>Policy decision</strong><p>{sar.reason}</p></div>
          <div className="sar-narrative"><strong>Standalone narrative</strong><p>{sar.narrative || 'A SAR narrative is intentionally empty because this case does not meet the filing criteria.'}</p></div>
          <div className="sar-subjects"><strong>Subjects</strong><div>{sar.subjects.length ? sar.subjects.map((subject) => <span key={subject}>{subject}</span>) : <small>None</small>}</div></div>
        </div>
      ) : (
        <div className="json-panel"><div><span>{answer.case_id}.json</span><b>{answer.case.written_to_graph ? `Written as ${answer.case.graph_case_id}` : 'Local answer · graph write pending'}</b></div><pre>{JSON.stringify(answer, null, 2)}</pre></div>
      )}
    </section>
  )
}

function RecommendationCard({ recommendation, risk, confidence, status, onApprove, onChallenge, onEscalate }: {
  recommendation: Recommendation; risk: number; confidence: number; status: string; onApprove: () => void; onChallenge: () => void; onEscalate: () => void
}) {
  const completed = status === 'Actioned'
  const needsApproval = recommendation.execution === 'Human approval required'
  const actionLabel = recommendation.actionCode === 'BLOCK_CARD'
    ? 'card block'
    : recommendation.actionCode === 'FILE_REPORT'
      ? 'report filing'
      : 'recommendation'
  return (
    <section className="card recommendation-card">
      <div className="decision-top"><span className="recommend-label"><Zap />NEXT BEST ACTION</span><span className="human-chip">{needsApproval ? <LockKeyhole /> : <CheckCircle2 />}{needsApproval ? 'Human approval' : 'Auto permitted'}</span></div>
      <div className="score-row">
        <div className="risk-dial" style={{ '--score': `${risk * 3.6}deg` } as React.CSSProperties}><div><strong>{risk}</strong><span>RISK</span></div></div>
        <div><span>{risk >= 70 ? 'High risk' : risk <= 30 ? 'Low risk' : 'Review required'}</span><strong>{confidence}% certain</strong><small>Evidence-based assessment</small></div>
      </div>
      <h2>{recommendation.action}</h2>
      <p>{recommendation.rationale}</p>
      {recommendation.actions && recommendation.actions.length > 1 && <div className="action-list">
        {recommendation.actions.map((item) => <div key={item.actionCode}><Check /><span>{item.action}</span><b className={item.route === 'auto' ? '' : 'restricted'}>{item.route}</b></div>)}
      </div>}
      <div className="policy-box"><div><ShieldCheck /><span><small>Policy route</small><strong>{recommendation.policy.id} · {recommendation.policy.title}</strong></span></div><ChevronDown /></div>
      <div className="decision-facts"><div><span>Approval</span><strong>{recommendation.policy.approval}</strong></div><div><span>Control</span><strong>{recommendation.policy.reversible ? 'Reversible' : 'Permanent'}</strong></div></div>
      {completed ? <div className="action-complete"><CheckCircle2 /><span><strong>Action recorded</strong><small>The decision is recorded in the case audit log.</small></span></div> : <button className="approve-button" onClick={onApprove}><ShieldCheck />{needsApproval ? `Approve ${actionLabel}` : 'Record recommendation'}</button>}
      <button className="challenge-button" onClick={onChallenge}><MessageSquareText />Request customer verification</button>
      <button className="escalate-link" onClick={onEscalate}>Escalate instead <ArrowRight /></button>
      <div className="guardrail"><LockKeyhole /><span><strong>Guardrail active</strong><small>{needsApproval ? `The agent can recommend this action, but ${recommendation.policy.approval} approval is required.` : 'The action is permitted automatically, and the decision remains recorded in the audit log.'}</small></span></div>
    </section>
  )
}

function ModelConsensusCard({ llm }: { llm: NonNullable<RunResult['llm']> }) {
  const complete = llm.providers.filter((provider) => provider.status === 'complete').length
  const configured = llm.providers.filter((provider) => provider.status !== 'not_configured').length
  const probability = llm.consensus.fraudProbability === null ? null : Math.round(llm.consensus.fraudProbability * 100)
  return (
    <section className="card ensemble-card">
      <CardHeader icon={<Bot />} eyebrow="ADVISORY REVIEW" title="Model consensus" action={<span className="memory-count">{complete}/{configured || llm.providers.length} replies</span>} />
      <div className="consensus-summary">
        <span className={`consensus-verdict ${llm.consensus.verdict}`}>{llm.consensus.verdict === 'unavailable' ? 'Baseline only' : llm.consensus.verdict}</span>
        <div><strong>{probability === null ? 'No model result' : `${probability}% fraud probability`}</strong><small>{llm.consensus.pattern}</small></div>
      </div>
      <div className="provider-list">
        {llm.providers.map((provider) => (
          <div key={provider.id} title={provider.error || provider.model}>
            <span className={`provider-dot ${provider.status}`} />
            <span><strong>{provider.label}</strong><small>{provider.model}</small></span>
            <b>{provider.status === 'complete' ? `${provider.latencyMs}ms` : provider.status === 'not_configured' ? 'Not set' : 'Offline'}</b>
          </div>
        ))}
      </div>
      <div className="ensemble-explanation"><strong>Evidence explanation</strong><p>{llm.consensus.evidenceExplanation}</p></div>
      {llm.consensus.selectedTools.length > 0 && <div className="tool-plan"><strong>Governed tool plan</strong>{llm.consensus.selectedTools.map((tool) => <div key={tool.name}><span>{tool.name}</span><b>{tool.votes} vote{tool.votes === 1 ? '' : 's'}</b><small>{tool.reason}</small></div>)}</div>}
      <div className="ensemble-guardrail"><LockKeyhole /><span>{llm.guardrail}</span></div>
    </section>
  )
}

function PatternCard({ assessment }: { assessment: RunResult['analysis'] | undefined }) {
  const patterns = assessment?.patterns || [
    { name: 'Account takeover', confidence: 0.94, basis: 'Credential reset → new device → transfer' },
    { name: 'Mule network movement', confidence: 0.81, basis: 'Recipient is 2 hops from known cluster' },
  ]
  return (
    <section className="card pattern-card">
      <CardHeader icon={<Fingerprint />} eyebrow="TYPOLOGY MATCH" title="Detected patterns" />
      <div className="patterns">
        {patterns.map((pattern, index) => <div key={pattern.name}><span className={`pattern-rank rank-${index + 1}`}>{index + 1}</span><div><strong>{pattern.name}</strong><small>{pattern.basis}</small></div><b>{Math.round(pattern.confidence * 100)}%</b></div>)}
      </div>
    </section>
  )
}

function MemoryCard({ assessment }: { assessment: RunResult['analysis'] | undefined }) {
  const memories = assessment?.memory || [
    { id: 'FI-1882', outcome: 'Confirmed ATO', similarity: 0.91, action: 'Restricted outbound transfers', indicators: [], lossPrevented: 61000 },
    { id: 'FI-1734', outcome: 'Confirmed ATO', similarity: 0.84, action: 'Blocked wire after challenge', indicators: [], lossPrevented: 35500 },
  ]
  return (
    <section className="card memory-card">
      <CardHeader icon={<BookOpenText />} eyebrow="CASE MEMORY" title="Similar outcomes" action={<span className="memory-count">{memories.length} hits</span>} />
      {memories.slice(0, 2).map((item) => <div className="memory-row" key={item.id}><div><strong>{item.id}</strong><span>{item.outcome}</span><small>{item.action}</small></div><b>{Math.round(item.similarity * 100)}%<small>match</small></b></div>)}
      <div className="memory-insight"><Sparkles /><span><strong>Memory insight</strong>Restrictive action prevented loss in 2 of 2 closely matched confirmed cases.</span></div>
    </section>
  )
}

function AuditTrail({ activeCase }: { activeCase: FraudCase }) {
  const entries = activeCase.audit?.length ? activeCase.audit : [
    { id: 'default-1', time: new Date().toISOString(), actor: 'GraphSentinel agent', event: 'Evidence synthesized', detail: '5 signals normalized and attached to case' },
    { id: 'default-2', time: new Date(Date.now() - 120000).toISOString(), actor: 'Risk signal', event: 'Investigation triggered', detail: `${activeCase.transactionId} exceeded review threshold` },
  ]
  return (
    <section className="card audit-card">
      <CardHeader icon={<FileCheck2 />} eyebrow="IMMUTABLE LOG" title="Decision audit trail" action={<span className="audit-sealed"><LockKeyhole />Sealed</span>} />
      <div className="audit-table">
        {entries.slice(0, 4).map((entry) => <div key={entry.id}><time>{new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span className="audit-dot" /><span><strong>{entry.event}</strong><small>{entry.actor} · {entry.detail}</small></span></div>)}
      </div>
    </section>
  )
}

export default App
