import { randomBytes } from 'node:crypto'
import { hashPassword } from '../server/auth.mjs'

const password = process.argv[2]
if (!password || password.length < 12) {
  console.error('Usage: node scripts/generate_auth_secrets.mjs "a-password-of-at-least-12-characters"')
  process.exit(1)
}

console.log(`APP_SESSION_SECRET=${randomBytes(48).toString('base64url')}`)
console.log(`APP_PASSWORD_HASH=${await hashPassword(password)}`)

