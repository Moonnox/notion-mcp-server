import express, { Request, Response } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'url'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { Server as MCPServer } from '@modelcontextprotocol/sdk/server/index.js'
import { initProxyWithConfig } from '../src/init-server.js'

const filename = fileURLToPath(import.meta.url)
const directory = path.dirname(filename)
const specPath = path.resolve(directory, '../scripts/notion-openapi.json')

const app = express()
const port = process.env.PORT || 3000

// Store active transport sessions by session ID
interface SessionInfo {
  transport: SSEServerTransport
  server: MCPServer
  notionApiKey: string
}
const sessions = new Map<string, SessionInfo>()

// Enable CORS for remote connections
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID')
  if (req.method === 'OPTIONS') {
    res.sendStatus(200)
  } else {
    next()
  }
})

app.use(express.json())

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

// SSE connection handler
async function handleSSEConnection(req: Request, res: Response) {
  console.log('New SSE connection request received')
  console.log('Query params:', req.query)

  // Extract configuration from query parameters
  const notionApiKey = req.query.notionApiKey as string
  const baseUrl = (req.query.baseUrl as string) || 'https://api.notion.com'
  const notionApiVersion = (req.query.notionApiVersion as string) || '2022-06-28'

  // Validate required parameters
  if (!notionApiKey) {
    console.error('Missing required parameter: notionApiKey')
    res.status(400).json({ 
      error: 'Missing required query parameter: notionApiKey',
      usage: '/sse?notionApiKey=YOUR_KEY&baseUrl=https://api.notion.com&notionApiVersion=2022-06-28'
    })
    return
  }

  // Generate session ID
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`
  console.log(`Creating session ${sessionId}`)

  try {
    console.log('Initializing MCP proxy with config:', {
      baseUrl,
      notionApiVersion,
      hasApiKey: !!notionApiKey,
      sessionId
    })

    // Initialize the proxy with the provided configuration
    const proxy = await initProxyWithConfig(specPath, {
      baseUrl,
      notionApiKey,
      notionApiVersion
    })

    console.log(`Creating SSE transport for session ${sessionId}`)
    // Create transport with /messages endpoint - the SDK will handle routing internally
    const transport = new SSEServerTransport('/messages', res)
    
    // Connect and store transport + server for this session
    console.log(`Connecting proxy to transport for session ${sessionId}`)
    await proxy.connect(transport)
    sessions.set(sessionId, { transport, server: proxy.getServer(), notionApiKey })
    
    // Send session ID as a custom header for the client to use
    res.setHeader('X-Session-ID', sessionId)
    
    // Clean up session when connection closes
    res.on('close', () => {
      console.log(`Session ${sessionId} closed`)
      sessions.delete(sessionId)
    })
    
    console.log(`MCP connection established successfully for session ${sessionId}`)
  } catch (error) {
    console.error(`Error establishing MCP connection for session ${sessionId}:`, error)
    sessions.delete(sessionId)
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to establish MCP connection',
        details: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

// SSE endpoint for MCP connections (primary)
app.get('/sse', handleSSEConnection)

// Alias endpoint for compatibility
app.get('/mcp', handleSSEConnection)

// POST endpoint for MCP messages with session ID (path parameter)
app.post('/messages/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params
  console.log(`Received message for session ${sessionId} (path param)`) 
  console.log('Message:', JSON.stringify(req.body, null, 2))

  // Try to delegate to a static handler on the transport class
  const candidates = ['handlePost', 'handlePOST', 'handle', 'post', 'receive', 'handleMessage', 'process']
  for (const name of candidates) {
    const maybeFn = (SSEServerTransport as any)[name]
    if (typeof maybeFn === 'function') {
      try {
        await maybeFn.call(SSEServerTransport, req, res)
        return
      } catch (error) {
        console.error(`Static ${name} failed:`, error)
        if (!res.headersSent) {
          res.status(500).json({ error: `Failed to process message via ${name}` })
        }
        return
      }
    }
  }

  console.warn('No static POST handler found on SSEServerTransport; returning 202 as fallback')
  res.status(202).json({ status: 'accepted' })
})

// POST endpoint for MCP messages (with query parameter or header)
app.post('/messages', async (req: Request, res: Response) => {
  console.log('Received POST to /messages')
  console.log('Query params:', req.query)
  console.log('Headers:', req.headers)
  console.log('Message:', JSON.stringify(req.body, null, 2))

  // Prefer a static handler on the transport class to route messages correctly
  const candidates = ['handlePost', 'handlePOST', 'handle', 'post', 'receive', 'handleMessage', 'process']
  for (const name of candidates) {
    const maybeFn = (SSEServerTransport as any)[name]
    if (typeof maybeFn === 'function') {
      try {
        await maybeFn.call(SSEServerTransport, req, res)
        return
      } catch (error) {
        console.error(`Static ${name} failed:`, error)
        if (!res.headersSent) {
          res.status(500).json({ error: `Failed to process message via ${name}` })
        }
        return
      }
    }
  }

  console.warn('No static POST handler found on SSEServerTransport; returning 202 as fallback')
  res.status(202).json({ status: 'accepted' })
})

// Start the server
app.listen(port, () => {
  console.log(`Notion MCP Server listening on port ${port}`)
  console.log(`SSE endpoint: http://localhost:${port}/sse`)
  console.log(`Health check: http://localhost:${port}/health`)
  console.log('\nUsage:')
  console.log(`  Connect to: http://localhost:${port}/sse?notionApiKey=YOUR_KEY&baseUrl=https://api.notion.com&notionApiVersion=2022-06-28`)
  console.log('\nRequired query parameters:')
  console.log('  - notionApiKey: Your Notion integration API key')
  console.log('\nOptional query parameters:')
  console.log('  - baseUrl: Notion API base URL (default: https://api.notion.com)')
  console.log('  - notionApiVersion: Notion API version (default: 2022-06-28)')
})

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server')
  process.exit(0)
})
