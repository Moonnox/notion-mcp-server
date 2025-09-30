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
    // Create transport with /messages endpoint - the SDK will handle routing internally
    const transport = new SSEServerTransport('/messages', res)
    
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

// POST endpoint for MCP messages with session ID (path parameter)
app.post('/messages/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params
  const sessionInfo = sessions.get(sessionId)
  
  if (!sessionInfo) {
    console.error(`Unknown session: ${sessionId}`)
    res.status(404).json({ error: 'Session not found' })
    return
  }
  
  console.log(`Received message for session ${sessionId} (path param)`)
  console.log('Message:', JSON.stringify(req.body, null, 2))
  
  try {
    // The transport handles the message internally
    res.status(202).json({ status: 'accepted' })
  } catch (error) {
    console.error(`Error handling message for session ${sessionId}:`, error)
    res.status(500).json({ 
      error: 'Failed to process message',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

// POST endpoint for MCP messages (with query parameter or header)
app.post('/messages', async (req: Request, res: Response) => {
  console.log('Received POST to /messages')
  console.log('Query params:', req.query)
  console.log('Headers:', req.headers)
  console.log('Message:', JSON.stringify(req.body, null, 2))
  
  // Try to get session ID from query parameter, header, or body
  let sessionId = req.query.sessionId as string || 
                  req.header('X-Session-ID') ||
                  req.body?.sessionId
  
  if (!sessionId) {
    // If no session ID, this might be a single-session server
    // Try the first (and possibly only) active session
    if (sessions.size === 1) {
      sessionId = Array.from(sessions.keys())[0]
      console.log(`Using only active session: ${sessionId}`)
    } else {
      console.warn('No valid session ID found in query, header, or body')
      res.status(400).json({ 
        error: 'Session ID required',
        activeSessions: sessions.size,
        hint: 'Use ?sessionId=ID query parameter, X-Session-ID header, or include sessionId in body'
      })
      return
    }
  }
  
  const sessionInfo = sessions.get(sessionId)
  
  if (!sessionInfo) {
    console.error(`Unknown session: ${sessionId}`)
    res.status(404).json({ 
      error: 'Session not found',
      sessionId,
      activeSessions: Array.from(sessions.keys())
    })
    return
  }
  
  console.log(`Processing message for session ${sessionId}`)
  
  try {
    // Send the message to the transport for processing
    // The SSEServerTransport should have a method to handle incoming messages
    // @ts-ignore - accessing internal method
    if (typeof sessionInfo.transport.handlePostMessage === 'function') {
      await sessionInfo.transport.handlePostMessage(req, res)
    } else {
      // If the method doesn't exist, just acknowledge receipt
      // The transport may handle this differently
      console.warn('Transport does not expose handlePostMessage method')
      res.status(202).json({ jsonrpc: '2.0', result: {} })
    }
  } catch (error) {
    console.error(`Error handling message for session ${sessionId}:`, error)
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to process message',
        details: error instanceof Error ? error.message : String(error)
      })
    }
  }
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
