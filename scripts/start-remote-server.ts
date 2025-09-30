import express, { Request, Response } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { initProxyWithConfig } from '../src/init-server.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

const filename = fileURLToPath(import.meta.url)
const directory = path.dirname(filename)
const specPath = path.resolve(directory, '../scripts/notion-openapi.json')

const app = express()
const port = process.env.PORT || 3000

interface MCPSession {
  id: string
  response: Response
  sendMessage: (message: JSONRPCMessage) => void
}

const sessions = new Map<string, MCPSession>()

// Enable CORS for remote connections
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
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

  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`
  console.log(`Creating session ${sessionId}`)

  try {
    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Session-ID': sessionId
    })

    // Send initial comment to establish connection
    res.write(': mcp-session-start\n\n')

    // Function to send messages via SSE
    const sendMessage = (message: JSONRPCMessage) => {
      console.log(`Sending SSE message for session ${sessionId}:`, JSON.stringify(message))
      res.write(`data: ${JSON.stringify(message)}\n\n`)
    }

    // Store session
    const session: MCPSession = { id: sessionId, response: res, sendMessage }
    sessions.set(sessionId, session)

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

    // Create a custom transport that bridges our SSE implementation with the MCP server
    // We'll use stdio transport but override its message sending
    const transport = new StdioServerTransport()
    
    // Override the send method to use SSE instead of stdio
    const originalSend = transport.send.bind(transport)
    transport.send = async (message: JSONRPCMessage) => {
      sendMessage(message)
    }

    console.log(`Connecting proxy to custom transport for session ${sessionId}`)
    await proxy.connect(transport)
    
    // Store the transport for receiving messages
    ;(session as any).transport = transport
    
    console.log(`MCP connection established successfully for session ${sessionId}`)

    // Clean up when connection closes
    res.on('close', () => {
      console.log(`Session ${sessionId} closed`)
      sessions.delete(sessionId)
    })
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

// POST endpoint for MCP messages
app.post('/messages', async (req: Request, res: Response) => {
  console.log('Received POST to /messages')
  console.log('Query params:', req.query)
  console.log('Body:', JSON.stringify(req.body, null, 2))

  // Get session ID from query parameter or use the only active session
  let sessionId = req.query.sessionId as string

  if (!sessionId && sessions.size === 1) {
    sessionId = Array.from(sessions.keys())[0]
    console.log(`Using only active session: ${sessionId}`)
  }

  if (!sessionId) {
    console.error('No session ID provided and multiple/no sessions active')
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Session ID required'
      },
      id: req.body.id || null
    })
    return
  }

  const session = sessions.get(sessionId)
  if (!session) {
    console.error(`Unknown session: ${sessionId}`)
    res.status(404).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Session not found'
      },
      id: req.body.id || null
    })
    return
  }

  try {
    const transport = (session as any).transport as StdioServerTransport
    
    // Send the message to the transport for processing
    // We need to simulate receiving it via stdin
    if (transport && typeof (transport as any).handleMessage === 'function') {
      console.log(`Forwarding message to transport for session ${sessionId}`)
      await (transport as any).handleMessage(req.body)
    } else {
      console.error('Transport does not have handleMessage method')
      // The response will be sent via SSE, just acknowledge receipt via HTTP
    }
    
    // Acknowledge receipt (actual response goes via SSE)
    res.status(202).end()
  } catch (error) {
    console.error(`Error processing message for session ${sessionId}:`, error)
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error'
      },
      id: req.body.id || null
    })
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
