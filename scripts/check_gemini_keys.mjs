import '../server/env.mjs'
import { checkGeminiKeys } from '../server/llm.mjs'

const report = await checkGeminiKeys()
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.valid ? 0 : 1
