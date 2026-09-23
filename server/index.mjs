import './env.mjs'
import express from 'express'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { cases } from './data.mjs'
import { createAgenticRun } from './agent.mjs'
import { fetchCaseContext, tigerGraphStatus, writeInvestigationCase } from './tigergraph.mjs'
import { hhgoaStatus, loadHHGOAAppCases } from './hhgoa.mjs'
import { llmStatus } from './llm.mjs'
import { createAuth } from './auth.mjs'

const app = express()
const port = Number(process.env.PORT || 8787)
const hhgoaCases = loadHHGOAAppCases()
const caseStore = structuredClone(hhgoaCases || cases)
const auditStore = new Map()
const auth = createAuth()

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
app.use(auth.securityHeaders)
app.use(express.json({ limit: '256kb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true, tigerGraph: tigerGraphStatus(), hhgoa: hhgoaStatus(), llm: llmStatus() }))
app.get('/api/auth/session', auth.session)
app.post('/api/auth/login', auth.login)
app.use('/api', auth.requireAuth, auth.requireCsrf)
app.post('/api/auth/logout', auth.logout)

app.get('/api/cases', (_req, res) => {
  res.json(caseStore.map(({ graph, evidence, ...item }) => ({ ...item, evidenceCount: evidence.length })))
})

app.get('/api/cases/:id', (req, res) => {
  const item = caseStore.find((candidate) => candidate.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Case not found' })
  res.json({ ...item, audit: auditStore.get(item.id) || [] })
})

app.post('/api/cases/:id/investigate', async (req, res) => {
  const item = caseStore.find((candidate) => candidate.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Case not found' })
  try {
    let graphContext = null
    let graphContextWarning = ''
    try {
      graphContext = await fetchCaseContext(item.transactionId)
    } catch (error) {
      graphContextWarning = error instanceof Error ? error.message : 'TigerGraph context was unavailable'
    }
    const run = await createAgenticRun(item)
    const answer = item.answer ? structuredClone(item.answer) : null
    let graphWriteback = null
    try {
      graphWriteback = answer ? await writeInvestigationCase(answer, item.transactionId, { cardId: item.account }) : null
    } catch (error) {
      graphContextWarning ||= error instanceof Error ? error.message : 'TigerGraph writeback was unavailable'
    }
    if (graphWriteback) {
      answer.case.written_to_graph = true
      answer.case.graph_case_id = graphWriteback.graphCaseId
    }
    const entry = { id: `AUD-${Date.now()}`, time: new Date().toISOString(), actor: 'GraphSentinel agent', event: 'Investigation completed', detail: run.analysis.recommendation.action }
    auditStore.set(item.id, [entry, ...(auditStore.get(item.id) || [])])
    res.json({ ...run, answer, graphContext, graphContextWarning, graphWriteback, graphMode: tigerGraphStatus().mode })
  } catch (error) {
    res.status(502).json({ error: error.message })
  }
})

app.post('/api/cases/:id/actions', (req, res) => {
  const item = caseStore.find((candidate) => candidate.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Case not found' })
  const { action, note = '' } = req.body || {}
  if (!['approve', 'challenge', 'escalate'].includes(action)) return res.status(400).json({ error: 'Unsupported action' })
  const states = { approve: 'Restriction approved', challenge: 'Customer challenge sent', escalate: 'Escalated to senior analyst' }
  item.status = action === 'approve' ? 'Actioned' : action === 'challenge' ? 'Evidence requested' : 'Escalated'
  const entry = { id: `AUD-${Date.now()}`, time: new Date().toISOString(), actor: req.user?.username || 'Authenticated analyst', event: states[action], detail: note || 'Recorded from analyst workspace' }
  auditStore.set(item.id, [entry, ...(auditStore.get(item.id) || [])])
  res.json({ ok: true, status: item.status, audit: auditStore.get(item.id) })
})

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(here, '..', 'dist')
app.use(express.static(dist))
app.use((_req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next()
  res.sendFile(path.join(dist, 'index.html'))
})

app.listen(port, () => console.log(`GraphSentinel API listening on http://localhost:${port}`))
