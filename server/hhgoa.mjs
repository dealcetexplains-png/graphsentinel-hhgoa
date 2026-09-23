import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(projectRoot, 'docs')
const indexPath = path.join(projectRoot, 'data', 'hhgoa', 'index.json')
const appCasesPath = path.join(projectRoot, 'data', 'hhgoa', 'app-cases.json')
const expectedTransactionBytes = 708_000_000

function sizeIfPresent(filePath) {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

export function hhgoaStatus() {
  const transactionsPath = path.join(sourceRoot, 'transactions.csv')
  const partialPath = path.join(sourceRoot, 'transactions.csv.crdownload')
  const transactionBytes = sizeIfPresent(transactionsPath)
  const partialBytes = sizeIfPresent(partialPath)
  const complete = transactionBytes > 0 && partialBytes === 0
  return {
    packageFound: fs.existsSync(path.join(sourceRoot, 'README.md')),
    complete,
    downloading: partialBytes > 0,
    transactionBytes: transactionBytes || partialBytes,
    approximateProgress: complete ? 1 : Math.min(0.99, partialBytes / expectedTransactionBytes),
    indexed: fs.existsSync(indexPath),
    appCasesReady: fs.existsSync(appCasesPath),
  }
}

export function loadHHGOAAppCases() {
  if (!fs.existsSync(appCasesPath)) return null
  const parsed = JSON.parse(fs.readFileSync(appCasesPath, 'utf8'))
  if (!Array.isArray(parsed) || parsed.length !== 20) {
    throw new Error('HHGOA app case file must contain exactly 20 cases')
  }
  return parsed
}

