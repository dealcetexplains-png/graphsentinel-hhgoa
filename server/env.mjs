import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function parseEnv(text) {
  const values = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

export function loadLocalEnv(directory = process.cwd()) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ENV_FILES !== 'true') return
  for (const filename of ['.env.local', '.env']) {
    const file = path.join(directory, filename)
    if (!existsSync(file)) continue
    const values = parseEnv(readFileSync(file, 'utf8'))
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

loadLocalEnv()
