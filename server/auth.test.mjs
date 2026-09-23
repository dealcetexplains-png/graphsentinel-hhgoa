import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuth, hashPassword, validateProductionSecrets, verifyPassword } from './auth.mjs'

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this },
  }
}

test('scrypt password hashes verify without storing the password', async () => {
  const encoded = await hashPassword('correct horse battery staple', Buffer.alloc(16, 7))
  assert.equal(encoded.includes('correct horse'), false)
  assert.equal(await verifyPassword('correct horse battery staple', encoded), true)
  assert.equal(await verifyPassword('wrong password', encoded), false)
})

test('production refuses to start with missing authentication secrets', () => {
  assert.throws(() => validateProductionSecrets({ NODE_ENV: 'production' }), /configuration is incomplete/)
})

test('login issues a secure HttpOnly session and CSRF-bound mutations', async () => {
  const passwordHash = await hashPassword('a strong testing password', Buffer.alloc(16, 9))
  const env = {
    NODE_ENV: 'production', APP_USERNAME: 'analyst', APP_PASSWORD_HASH: passwordHash,
    APP_SESSION_SECRET: 'a'.repeat(48), APP_ORIGIN: 'https://fraud.example',
  }
  const auth = createAuth(env)
  const loginReq = {
    body: { username: 'analyst', password: 'a strong testing password' }, ip: '198.51.100.5',
    socket: {}, headers: {}, get(name) { return name.toLowerCase() === 'origin' ? 'https://fraud.example' : undefined },
  }
  const loginRes = response()
  await auth.login(loginReq, loginRes)
  assert.equal(loginRes.statusCode, 200)
  assert.match(loginRes.headers['Set-Cookie'], /__Host-gs_session=/)
  assert.match(loginRes.headers['Set-Cookie'], /HttpOnly/)
  assert.match(loginRes.headers['Set-Cookie'], /Secure/)
  assert.match(loginRes.headers['Set-Cookie'], /SameSite=Strict/)

  const cookie = loginRes.headers['Set-Cookie'].split(';')[0]
  const request = {
    method: 'POST', headers: { cookie },
    get(name) {
      if (name.toLowerCase() === 'origin') return 'https://fraud.example'
      if (name.toLowerCase() === 'x-csrf-token') return loginRes.body.csrfToken
      return undefined
    },
  }
  const authRes = response()
  let authenticated = false
  auth.requireAuth(request, authRes, () => { authenticated = true })
  assert.equal(authenticated, true)
  let csrfAccepted = false
  auth.requireCsrf(request, authRes, () => { csrfAccepted = true })
  assert.equal(csrfAccepted, true)
})
