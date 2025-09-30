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

// SSE endpoint for MCP connections
app.get('/sse', async (req: Request, res: Response) => {
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
    const transport = new SSEServerTransport('/messages', res)
    
    console.log('Connecting proxy to transport')
    await proxy.connect(transport)
    
    console.log('MCP connection established successfully')
  } catch (error) {
    console.error('Error establishing MCP connection:', error)
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to establish MCP connection',
        details: error instanceof Error ? error.message : String(error)
      })
    }
  }
})

// POST endpoint for MCP messages (required for SSE transport)
app.post('/messages', async (req: Request, res: Response) => {
  // This endpoint is handled by the SSE transport
  // It should not normally be called directly
  res.status(200).json({ status: 'ok' })
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

