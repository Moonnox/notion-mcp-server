import express, { Request, Response } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'url'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { initProxyWithConfig } from '../src/init-server.js'

const filename = fileURLToPath(import.meta.url)
const directory = path.dirname(filename)
const specPath = path.resolve(directory, '../scripts/notion-openapi.json')

const app = express()
const port = process.env.PORT || 3000

// Store active transport sessions by session ID
interface SessionInfo {
  transport: SSEServerTransport
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
    // Use session-specific message endpoint
    const transport = new SSEServerTransport(`/messages/${sessionId}`, res)
    
    // Store transport and config for this session
    sessions.set(sessionId, { transport, notionApiKey })
    
    // Send session ID as a custom header for the client to use
    res.setHeader('X-Session-ID', sessionId)
    
    // Clean up session when connection closes
    res.on('close', () => {
      console.log(`Session ${sessionId} closed`)
      sessions.delete(sessionId)
    })
    
    console.log(`Connecting proxy to transport for session ${sessionId}`)
    await proxy.connect(transport)
    
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

// POST endpoint for MCP messages with session ID
app.post('/messages/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params
  const sessionInfo = sessions.get(sessionId)
  
  if (!sessionInfo) {
    console.error(`Unknown session: ${sessionId}`)
    res.status(404).json({ error: 'Session not found' })
    return
  }
  
  console.log(`Received message for session ${sessionId}`)
  
  try {
    // Forward the message to the transport
    // The SSEServerTransport expects to handle messages internally
    // This is handled automatically when the transport is connected to the server
    res.status(202).json({ status: 'accepted' })
  } catch (error) {
    console.error(`Error handling message for session ${sessionId}:`, error)
    res.status(500).json({ 
      error: 'Failed to process message',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

// Fallback POST endpoint for MCP messages (without session)
app.post('/messages', async (req: Request, res: Response) => {
  console.log('Received POST to /messages without session ID')
  
  // Try to get session ID from header
  const sessionId = req.header('X-Session-ID')
  
  if (sessionId && sessions.has(sessionId)) {
    // Forward to session-specific endpoint
    req.params.sessionId = sessionId
    return app._router.handle(req, res, () => {})
  }
  
  console.warn('No valid session found for message')
  res.status(400).json({ 
    error: 'Session ID required',
    hint: 'Use X-Session-ID header or /messages/:sessionId endpoint'
  })
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
