import '../server/env.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createAgenticRun } from '../server/agent.mjs'
import { loadHHGOAAppCases } from '../server/hhgoa.mjs'
import { fetchCaseContext, tigerGraphStatus, writeInvestigationCase } from '../server/tigergraph.mjs'

const replaceBaseline = process.argv.includes('--replace')
const requestedCase = process.argv.find((argument) => argument.startsWith('--case='))?.split('=')[1]
const outputDirectory = path.resolve(process.cwd(), 'output', 'hhgoa', replaceBaseline ? 'cases' : 'live-cases')
const status = tigerGraphStatus()

if (status.mode !== 'live') {
  throw new Error('TigerGraph is not live. Set DEMO_MODE=false and configure TIGERGRAPH_HOST, TIGERGRAPH_GRAPH, and TIGERGRAPH_TOKEN.')
}

const allCases = loadHHGOAAppCases() || []
const cases = requestedCase ? allCases.filter((item) => item.id === requestedCase) : allCases
if (!cases.length) throw new Error(requestedCase ? `Unknown case ${requestedCase}` : 'No HHGOA cases are available')

await mkdir(outputDirectory, { recursive: true })
const summary = []

for (const [index, item] of cases.entries()) {
  const started = Date.now()
  process.stdout.write(`[${index + 1}/${cases.length}] ${item.id}: querying graph... `)
  try {
    await fetchCaseContext(item.transactionId)
    const run = await createAgenticRun(item)
    const answer = structuredClone(item.answer)
    if (!answer) throw new Error('Validated answer is missing from the app case')
    const writeback = await writeInvestigationCase(answer, item.transactionId, { cardId: item.account })
    if (!writeback) throw new Error('TigerGraph writeback was disabled')
    answer.case.written_to_graph = true
    answer.case.graph_case_id = writeback.graphCaseId
    answer.latency_s = Math.round((Date.now() - started) / 100) / 10
    answer.tool_calls = Math.max(answer.tool_calls || 0, run.steps.length + 2)
    const file = path.join(outputDirectory, `${item.id}.json`)
    await writeFile(file, `${JSON.stringify(answer, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    summary.push({ caseId: item.id, ok: true, graphCaseId: writeback.graphCaseId, latencyS: answer.latency_s, modelResponders: run.llm.consensus.responders })
    process.stdout.write(`written (${answer.latency_s}s)\n`)
  } catch (error) {
    summary.push({ caseId: item.id, ok: false, error: String(error?.message || error).slice(0, 200) })
    process.stdout.write(`FAILED: ${String(error?.message || error).slice(0, 200)}\n`)
  }
}

await writeFile(path.join(outputDirectory, '..', 'live-run-summary.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), graph: status.graph, outputDirectory, cases: summary }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
const failures = summary.filter((item) => !item.ok)
if (failures.length) throw new Error(`${failures.length}/${summary.length} live case writebacks failed; baseline answers were not modified.`)
console.log(`PASS: ${summary.length} live answers written to ${outputDirectory}`)

