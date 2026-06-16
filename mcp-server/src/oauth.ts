import crypto from 'node:crypto'
import { Router, Request, Response } from 'express'

export interface OAuthConfig {
  baseUrl: string       // e.g. https://brain.canimagin.com/mcp
  adminToken: string    // MCP_BEARER_TOKEN — used as the login password
}

interface RegisteredClient {
  clientId: string
  redirectUris: string[]
  clientName: string
}

interface AuthCode {
  code: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
  expiresAt: number
}

interface TokenRecord {
  clientId: string
  expiresAt: number
}

const clients = new Map<string, RegisteredClient>()
const codes = new Map<string, AuthCode>()
const accessTokens = new Map<string, TokenRecord>()
const refreshTokens = new Map<string, TokenRecord>()

function randomToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function verifyPkce(verifier: string, challenge: string): boolean {
  const digest = crypto.createHash('sha256').update(verifier).digest('base64url')
  if (digest.length !== challenge.length) return false
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(challenge))
}

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of codes) if (v.expiresAt < now) codes.delete(k)
  for (const [k, v] of accessTokens) if (v.expiresAt < now) accessTokens.delete(k)
  for (const [k, v] of refreshTokens) if (v.expiresAt < now) refreshTokens.delete(k)
}, 5 * 60 * 1000)

export function validateAccessToken(token: string): boolean {
  const rec = accessTokens.get(token)
  return !!rec && rec.expiresAt > Date.now()
}

function asMetadata(cfg: OAuthConfig) {
  return {
    issuer: cfg.baseUrl,
    authorization_endpoint: `${cfg.baseUrl}/authorize`,
    token_endpoint: `${cfg.baseUrl}/token`,
    registration_endpoint: `${cfg.baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    // OIDC compat fields (claude.ai probes openid-configuration too)
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid'],
  }
}

export function createOAuthRouter(cfg: OAuthConfig): Router {
  const r = Router()

  // Protected Resource Metadata (RFC 9728)
  r.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: cfg.baseUrl,
      authorization_servers: [cfg.baseUrl],
    })
  })

  // Authorization Server Metadata (RFC 8414) — path under /mcp prefix
  r.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json(asMetadata(cfg))
  })

  // OIDC discovery — claude.ai also probes this under the /mcp prefix
  r.get('/.well-known/openid-configuration', (_req, res) => {
    res.json(asMetadata(cfg))
  })

  // Dynamic Client Registration (RFC 7591)
  r.post('/register', (req, res) => {
    const { redirect_uris, client_name } = req.body as {
      redirect_uris?: string[]
      client_name?: string
    }
    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' })
      return
    }
    const clientId = randomToken()
    clients.set(clientId, { clientId, redirectUris: redirect_uris, clientName: client_name ?? 'Unknown' })
    res.status(201).json({
      client_id: clientId,
      redirect_uris,
      client_name: client_name ?? 'Unknown',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
  })

  // Authorization endpoint — GET shows login form
  r.get('/authorize', (req, res) => {
    const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state } =
      req.query as Record<string, string>

    if (response_type !== 'code' || !code_challenge || code_challenge_method !== 'S256') {
      res.status(400).send('Invalid authorization request')
      return
    }
    if (!clients.has(client_id)) {
      res.status(400).send('Unknown client')
      return
    }

    const qs = new URLSearchParams({ client_id, redirect_uri, code_challenge, state: state ?? '' })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(`<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>Second Brain — Claude autorisieren</title>
<style>body{font-family:sans-serif;max-width:420px;margin:80px auto;padding:0 16px}
input{width:100%;padding:8px;margin:8px 0;box-sizing:border-box}
button{width:100%;padding:10px;background:#6c63ff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:1rem}
</style></head>
<body>
<h2>Second Brain für Claude autorisieren</h2>
<p>Gib das Admin-Token ein, um den Zugriff zu erlauben.</p>
<form method="POST" action="/mcp/authorize?${qs}">
  <input type="password" name="password" placeholder="Admin-Token" autofocus required>
  <button type="submit">Autorisieren</button>
</form>
</body></html>`)
  })

  // Authorization endpoint — POST processes the form
  r.post('/authorize', (req, res) => {
    const { client_id, redirect_uri, code_challenge, state } = req.query as Record<string, string>
    const { password } = req.body as { password?: string }

    if (!password || !crypto.timingSafeEqual(Buffer.from(password), Buffer.from(cfg.adminToken))) {
      res.status(401).send('Falsches Token.')
      return
    }

    const client = clients.get(client_id)
    if (!client || !client.redirectUris.includes(redirect_uri)) {
      res.status(400).send('Invalid client or redirect_uri')
      return
    }

    const code = randomToken()
    codes.set(code, {
      code,
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      state: state ?? '',
      expiresAt: Date.now() + 5 * 60 * 1000,
    })

    const callbackUrl = new URL(redirect_uri)
    callbackUrl.searchParams.set('code', code)
    callbackUrl.searchParams.set('iss', cfg.baseUrl)
    if (state) callbackUrl.searchParams.set('state', state)
    res.redirect(callbackUrl.toString())
  })

  // Token endpoint — handles authorization_code and refresh_token
  r.post('/token', (req, res) => {
    // Must accept application/x-www-form-urlencoded (express.urlencoded parses this)
    const { grant_type, code, code_verifier, redirect_uri, refresh_token, client_id } =
      req.body as Record<string, string>

    if (grant_type === 'authorization_code') {
      const record = codes.get(code)
      if (!record || record.expiresAt < Date.now()) {
        res.status(400).json({ error: 'invalid_grant' })
        return
      }
      if (record.clientId !== client_id || record.redirectUri !== redirect_uri) {
        res.status(400).json({ error: 'invalid_grant' })
        return
      }
      if (!verifyPkce(code_verifier, record.codeChallenge)) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' })
        return
      }
      codes.delete(code)

      const access = randomToken()
      const refresh = randomToken()
      accessTokens.set(access, { clientId: client_id, expiresAt: Date.now() + 60 * 60 * 1000 })
      refreshTokens.set(refresh, { clientId: client_id, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 })

      res.json({ access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh })
      return
    }

    if (grant_type === 'refresh_token') {
      const record = refreshTokens.get(refresh_token)
      if (!record || record.expiresAt < Date.now()) {
        res.status(400).json({ error: 'invalid_grant' })
        return
      }
      refreshTokens.delete(refresh_token) // rotate

      const access = randomToken()
      const newRefresh = randomToken()
      accessTokens.set(access, { clientId: record.clientId, expiresAt: Date.now() + 60 * 60 * 1000 })
      refreshTokens.set(newRefresh, { clientId: record.clientId, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 })

      res.json({ access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: newRefresh })
      return
    }

    res.status(400).json({ error: 'unsupported_grant_type' })
  })

  return r
}
