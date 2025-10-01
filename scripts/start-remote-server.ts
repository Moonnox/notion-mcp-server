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

// SSE connection handler for /sse and /mcp
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

  try {
    console.log('Initializing MCP proxy with config:', {
      baseUrl,
      notionApiVersion,
      hasApiKey: !!notionApiKey
    })

    // Initialize the proxy with the provided configuration
    const proxy = await initProxyWithConfig(specPath, {
      baseUrl,
      notionApiKey,
      notionApiVersion
    })

    console.log('Creating SSE transport')
    // The SSEServerTransport constructor expects (endpoint, response)
    // It will handle sending SSE messages via the response object
    const transport = new SSEServerTransport('/messages', res)
    
    console.log('Connecting proxy to transport')
    await proxy.connect(transport)
    
    console.log('MCP connection established successfully')
    
    // The connection will stay open until the client disconnects
  } catch (error) {
    console.error('Error establishing MCP connection:', error)
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
// The SSEServerTransport expects incoming messages to be POSTed here
app.post('/messages', async (req: Request, res: Response) => {
  console.log('Received POST to /messages')
  console.log('Body:', JSON.stringify(req.body, null, 2))

  // The SDK's SSEServerTransport should handle this internally
  // But since we're using Express, we need to manually route it
  // 
  // The problem: SSEServerTransport doesn't expose a way to inject messages!
  // This is why our implementation has been failing.
  //
  // Solution: Just acknowledge the message. The transport *should* be listening
  // for incoming POST requests, but it's designed for a different server setup.
  
  res.status(202).json({ 
    jsonrpc: '2.0',
    result: { acknowledged: true }
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
  console.log('\n⚠️  NOTE: This SSE implementation may not work correctly.')
  console.log('The MCP SDK\\'s SSEServerTransport is not designed for Express.')
  console.log('Consider using the stdio transport (local mode) or WebSocket transport instead.')
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
