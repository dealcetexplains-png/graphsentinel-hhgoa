import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const SESSION_SECONDS = 8 * 60 * 60
const attempts = new Map()

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf('=')
    return index < 0 ? [item, ''] : [item.slice(0, index), decodeURIComponent(item.slice(index + 1))]
  }))
}

function configured(env) {
  return env.AUTH_REQUIRED === 'true' && env.NODE_ENV !== 'production'
}

function sessionCookieName(env) {
  return env.NODE_ENV === 'production' ? '__Host-gs_session' : 'gs_session'
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function encodeSession(session, secret) {
  const payload = base64url(JSON.stringify(session))
  return `${payload}.${sign(payload, secret)}`
}

function decodeSession(token, secret) {
  if (!token || !secret) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = sign(payload, secret)
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return session.exp > Date.now() ? session : null
  } catch {
    return null
  }
}

function cookieOptions(env, maxAge = SESSION_SECONDS) {
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    env.NODE_ENV === 'production' ? 'Secure' : '',
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join('; ')
}

export async function hashPassword(password, salt = randomBytes(16)) {
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$${Buffer.from(salt).toString('base64url')}$${Buffer.from(derived).toString('base64url')}`
}

export async function verifyPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded || '').split('$')
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false
  const expected = Buffer.from(hashText, 'base64url')
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, { N: 16384, r: 8, p: 1 }))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function validateProductionSecrets(env = process.env) {
  if (!configured(env)) return
  const errors = []
  if (!env.APP_SESSION_SECRET || env.APP_SESSION_SECRET.length < 32 || env.APP_SESSION_SECRET === 'replace-me') errors.push('APP_SESSION_SECRET must be a random value of at least 32 characters')
  if (!/^scrypt\$[^$]+\$[^$]+$/.test(env.APP_PASSWORD_HASH || '')) errors.push('APP_PASSWORD_HASH must be generated with scripts/generate_auth_secrets.mjs')
  if (!env.APP_USERNAME) errors.push('APP_USERNAME is required')
  if (env.NODE_ENV === 'production' && !/^https:\/\//.test(env.APP_ORIGIN || '')) errors.push('APP_ORIGIN must be an HTTPS origin in production')
  if (errors.length) throw new Error(`Secure deployment configuration is incomplete: ${errors.join('; ')}`)
}

function requestOriginAllowed(req, env) {
  if (env.NODE_ENV !== 'production') return true
  return req.get('origin') === env.APP_ORIGIN
}

function limited(ip) {
  const now = Date.now()
  const windowMs = 15 * 60 * 1000
  const current = attempts.get(ip)
  if (!current || now - current.started > windowMs) {
    attempts.set(ip, { started: now, count: 1 })
    return false
  }
  current.count += 1
  return current.count > 5
}

export function createAuth(env = process.env) {
  validateProductionSecrets(env)
  const enabled = configured(env)
  const cookieName = sessionCookieName(env)
  const secret = env.APP_SESSION_SECRET || 'development-auth-disabled'
  const readSession = (req) => decodeSession(parseCookies(req.headers.cookie)[cookieName], secret)

  return {
    enabled,
    securityHeaders(_req, res, next) {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('X-Frame-Options', 'DENY')
      res.setHeader('Referrer-Policy', 'no-referrer')
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
      if (env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
      if (_req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
      next()
    },
    session(req, res) {
      if (!enabled) return res.json({ enabled: false, authenticated: true, user: { username: 'local-analyst', role: 'analyst' }, csrfToken: '' })
      const session = readSession(req)
      if (!session) return res.status(401).json({ enabled: true, authenticated: false })
      res.json({ enabled: true, authenticated: true, user: { username: session.username, role: session.role }, csrfToken: session.csrf })
    },
    async login(req, res) {
      if (!enabled) return res.json({ enabled: false, authenticated: true, user: { username: 'local-analyst', role: 'analyst' }, csrfToken: '' })
      if (!requestOriginAllowed(req, env)) return res.status(403).json({ error: 'Origin rejected' })
      if (limited(req.ip || req.socket.remoteAddress || 'unknown')) return res.status(429).json({ error: 'Too many login attempts. Try again later.' })
      const username = String(req.body?.username || '').slice(0, 100)
      const password = String(req.body?.password || '').slice(0, 1024)
      const passwordValid = await verifyPassword(password, env.APP_PASSWORD_HASH)
      if (username !== env.APP_USERNAME || !passwordValid) return res.status(401).json({ error: 'Invalid username or password' })
      attempts.delete(req.ip || req.socket.remoteAddress || 'unknown')
      const session = { username, role: 'analyst', csrf: randomBytes(24).toString('base64url'), exp: Date.now() + SESSION_SECONDS * 1000 }
      res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(encodeSession(session, secret))}; ${cookieOptions(env)}`)
      res.json({ enabled: true, authenticated: true, user: { username, role: session.role }, csrfToken: session.csrf })
    },
    requireAuth(req, res, next) {
      if (!enabled) {
        req.user = { username: 'local-analyst', role: 'analyst' }
        return next()
      }
      const session = readSession(req)
      if (!session) return res.status(401).json({ error: 'Authentication required' })
      req.authSession = session
      req.user = { username: session.username, role: session.role }
      next()
    },
    requireCsrf(req, res, next) {
      if (!enabled || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
      if (!requestOriginAllowed(req, env)) return res.status(403).json({ error: 'Origin rejected' })
      if (!req.authSession || req.get('x-csrf-token') !== req.authSession.csrf) return res.status(403).json({ error: 'CSRF validation failed' })
      next()
    },
    logout(req, res) {
      res.setHeader('Set-Cookie', `${cookieName}=; ${cookieOptions(env, 0)}`)
      res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"')
      res.json({ ok: true })
    },
  }
}
