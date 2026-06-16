import express from 'express'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createOAuthRouter, validateAccessToken } from './oauth.js'
import { registerTools } from './tools.js'

const PORT = parseInt(process.env.PORT ?? '8080')
const BASE_URL = process.env.MCP_BASE_URL ?? 'https://brain.canimagin.com/mcp'
const ADMIN_TOKEN = process.env.MCP_BEARER_TOKEN ?? ''
const VAULT_DIR = process.env.VAULT_DIR ?? '/vault-mirror'

if (!ADMIN_TOKEN) { console.error('MCP_BEARER_TOKEN is required'); process.exit(1) }

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// Request logging
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path} | origin=${req.headers.origin ?? '-'} | ct=${req.headers['content-type'] ?? '-'}`)
  next()
})

// CORS — no wildcard when credentials are involved
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin === 'https://claude.ai' || origin?.endsWith('.anthropic.com')) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  }
  if (req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
})

// RFC 8414 §3 path-based discovery: /.well-known/{type}/{issuer-path}
// claude.ai probes these root-level URLs when the issuer has a path component
const rootMeta = {
  issuer: BASE_URL,
  authorization_endpoint: `${BASE_URL}/authorize`,
  token_endpoint: `${BASE_URL}/token`,
  registration_endpoint: `${BASE_URL}/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid'],
}
app.get('/.well-known/oauth-authorization-server/mcp', (_req, res) => res.json(rootMeta))
app.get('/.well-known/openid-configuration/mcp', (_req, res) => res.json(rootMeta))

// All MCP + OAuth routes are under /mcp (the path Cloudflare routes to this container)
const mcpRouter = express.Router()
app.use('/mcp', mcpRouter)

// Mount OAuth endpoints on the MCP router
mcpRouter.use(createOAuthRouter({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN }))

// Bearer token guard for the MCP endpoint itself
function requireBearer(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`)
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  if (!validateAccessToken(auth.slice(7))) {
    res.setHeader('WWW-Authenticate', `Bearer error="invalid_token", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`)
    res.status(401).json({ error: 'invalid_token' })
    return
  }
  next()
}

// Active MCP sessions
const sessions = new Map<string, StreamableHTTPServerTransport>()

function newSession(): StreamableHTTPServerTransport {
  const sessionId = randomUUID()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId })
  const server = new McpServer({ name: 'second-brain', version: '1.0.0' })
  registerTools(server, VAULT_DIR)
  server.connect(transport)
  sessions.set(sessionId, transport)
  transport.onclose = () => sessions.delete(sessionId)
  return transport
}

// MCP Streamable HTTP endpoint
mcpRouter.post('/', requireBearer, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  let transport: StreamableHTTPServerTransport | undefined

  if (sessionId) {
    transport = sessions.get(sessionId)
    if (!transport) { res.status(404).json({ error: 'Session not found' }); return }
  } else {
    transport = newSession()
  }

  await transport.handleRequest(req, res, req.body)
})

mcpRouter.get('/', requireBearer, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  const transport = sessionId ? sessions.get(sessionId) : undefined
  if (!transport) { res.status(404).json({ error: 'Session not found' }); return }
  await transport.handleRequest(req, res)
})

mcpRouter.delete('/', requireBearer, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  const transport = sessionId ? sessions.get(sessionId) : undefined
  if (!transport) { res.status(404).json({ error: 'Session not found' }); return }
  await transport.handleRequest(req, res)
})

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.listen(PORT, () => console.log(`MCP server listening on :${PORT}, vault: ${VAULT_DIR}`))
