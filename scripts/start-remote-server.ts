import express from 'express'
import type { Request, Response } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'url'
import { initProxyWithConfig } from '../src/init-server.js'
import type { MCPProxy } from '../src/openapi-mcp-server/mcp/proxy.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const filename = fileURLToPath(import.meta.url)
const directory = path.dirname(filename)
const specPath = path.resolve(directory, '../scripts/notion-openapi.json')

const app = express()
const port = process.env.PORT || 3000

// Store MCP server instances per API key (for multi-tenant support)
const serverCache = new Map<string, MCPProxy>()

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
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

// Root endpoint with server information
app.get('/', (req, res) => {
  res.json({
    service: 'Notion MCP Server',
    version: '1.8.1',
    description: 'Model Context Protocol server for Notion API',
    endpoints: {
      '/health': 'Health check endpoint',
      '/mcp': 'MCP JSON-RPC endpoint (POST)',
      '/tools': 'List available tools'
    },
    usage: {
      mcp_endpoint: '/mcp',
      required_query_params: ['notionApiKey'],
      optional_query_params: ['baseUrl', 'notionApiVersion']
    }
  })
})

// Get or create MCP server instance for given config
async function getOrCreateServer(
  notionApiKey: string,
  baseUrl: string,
  notionApiVersion: string
): Promise<MCPProxy> {
  const cacheKey = `${notionApiKey}:${baseUrl}:${notionApiVersion}`
  
  if (serverCache.has(cacheKey)) {
    return serverCache.get(cacheKey)!
  }

  console.log('Creating new MCP server instance')
  const proxy = await initProxyWithConfig(specPath, {
    baseUrl,
    notionApiKey,
    notionApiVersion
  })

  serverCache.set(cacheKey, proxy)
  return proxy
}

// Main MCP endpoint - handles all JSON-RPC requests
app.post('/mcp', async (req, res) => {
  try {
    const body = req.body
    console.log('Received MCP request:', JSON.stringify(body, null, 2))

    // Extract configuration from query parameters
    const notionApiKey = req.query.notionApiKey as string
    const baseUrl = (req.query.baseUrl as string) || 'https://api.notion.com'
    const notionApiVersion = (req.query.notionApiVersion as string) || '2022-06-28'

    // Validate required parameters
    if (!notionApiKey) {
      return res.status(200).json({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Missing required query parameter: notionApiKey'
        },
        id: body.id || null
      })
    }

    const method = body.method
    const params = body.params || {}
    const requestId = body.id

    // Get or create MCP server instance
    const proxy = await getOrCreateServer(notionApiKey, baseUrl, notionApiVersion)
    const server = proxy.getServer()

    // Route to appropriate handler based on method
    if (method === 'initialize') {
      const result = {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          prompts: null,
          resources: null
        },
        serverInfo: {
          name: 'notion-mcp-server',
          version: '1.8.1'
        }
      }

      return res.json({
        jsonrpc: '2.0',
        result,
        id: requestId
      })
    } 
    else if (method === 'tools/list') {
      // Access the internal request handlers directly
      const handlers = (server as any)._requestHandlers
      const listToolsHandler = handlers?.get(ListToolsRequestSchema)
      
      if (listToolsHandler) {
        const result = await listToolsHandler({})
        return res.json({
          jsonrpc: '2.0',
          result,
          id: requestId
        })
      } else {
        throw new Error('tools/list handler not found')
      }
    }
    else if (method === 'tools/call') {
      // Access the internal request handlers directly
      const handlers = (server as any)._requestHandlers
      const callToolHandler = handlers?.get(CallToolRequestSchema)
      
      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: params.name,
            arguments: params.arguments || {}
          }
        })
        return res.json({
          jsonrpc: '2.0',
          result,
          id: requestId
        })
      } else {
        throw new Error('tools/call handler not found')
      }
    }
    else {
      // Method not found
      return res.json({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        },
        id: requestId
      })
    }
  } catch (error) {
    console.error('Error handling MCP request:', error)
    return res.json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: `Internal error: ${error instanceof Error ? error.message : String(error)}`
      },
      id: req.body?.id || null
    })
  }
})

// List available tools endpoint  
app.get('/tools', async (req, res) => {
  try {
    // Use a placeholder API key for listing tools (doesn't execute, just lists)
    const notionApiKey = req.query.notionApiKey as string || 'placeholder'
    const proxy = await getOrCreateServer(notionApiKey, 'https://api.notion.com', '2022-06-28')
    const server = proxy.getServer()

    const handlers = (server as any)._requestHandlers
    const listToolsHandler = handlers?.get(ListToolsRequestSchema)
    
    if (listToolsHandler) {
      const result = await listToolsHandler({})
      return res.json(result)
    } else {
      throw new Error('tools/list handler not found')
    }
  } catch (error) {
    console.error('Error listing tools:', error)
    return res.status(500).json({
      error: 'Failed to list tools',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

// Start the server
app.listen(port, () => {
  console.log(`Notion MCP Server listening on port ${port}`)
  console.log(`MCP endpoint: http://localhost:${port}/mcp`)
  console.log(`Health check: http://localhost:${port}/health`)
  console.log('\nUsage:')
  console.log(`  POST to: http://localhost:${port}/mcp?notionApiKey=YOUR_KEY`)
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
