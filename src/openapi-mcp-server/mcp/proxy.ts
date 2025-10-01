import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, JSONRPCResponse, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js'
import { JSONSchema7 as IJsonSchema } from 'json-schema'
import { OpenAPIToMCPConverter } from '../openapi/parser.js'
import { HttpClient, HttpClientError } from '../client/http-client.js'
import { OpenAPIV3 } from 'openapi-types'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

type PathItemObject = OpenAPIV3.PathItemObject & {
  get?: OpenAPIV3.OperationObject
  put?: OpenAPIV3.OperationObject
  post?: OpenAPIV3.OperationObject
  delete?: OpenAPIV3.OperationObject
  patch?: OpenAPIV3.OperationObject
}

type NewToolDefinition = {
  methods: Array<{
    name: string
    description: string
    inputSchema: IJsonSchema & { type: 'object' }
    returnSchema?: IJsonSchema
  }>
}

export interface MCPProxyConfig {
  baseUrl?: string
  notionApiKey: string
  notionApiVersion?: string
}

// import this class, extend and return server
export class MCPProxy {
  private server: Server
  private httpClient: HttpClient
  private tools: Record<string, NewToolDefinition>
  private openApiLookup: Record<string, OpenAPIV3.OperationObject & { method: string; path: string }>
  private config?: MCPProxyConfig

  constructor(name: string, openApiSpec: OpenAPIV3.Document, config?: MCPProxyConfig) {
    this.server = new Server({ name, version: '1.0.0' }, { capabilities: { tools: {} } })
    this.config = config
    
    const baseUrl = openApiSpec.servers?.[0].url
    if (!baseUrl) {
      throw new Error('No base URL found in OpenAPI spec')
    }
    this.httpClient = new HttpClient(
      {
        baseUrl,
        headers: this.parseHeaders(),
      },
      openApiSpec,
    )

    // Convert OpenAPI spec to MCP tools
    const converter = new OpenAPIToMCPConverter(openApiSpec)
    const { tools, openApiLookup } = converter.convertToMCPTools()
    this.tools = tools
    this.openApiLookup = openApiLookup

    this.setupHandlers()
  }

  private setupHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = []

      // Add methods as separate tools to match the MCP format
      Object.entries(this.tools).forEach(([toolName, def]) => {
        def.methods.forEach(method => {
          const toolNameWithMethod = toolName ? `${toolName}-${method.name}` : method.name;
          const truncatedToolName = this.truncateToolName(toolNameWithMethod);
          tools.push({
            name: truncatedToolName,
            description: method.description,
            inputSchema: method.inputSchema as Tool['inputSchema'],
          })
        })
      })

      return { tools }
    })

    // Handle tool calling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: params } = request.params

      // Find the operation in OpenAPI spec
      const operation = this.findOperation(name)
      if (!operation) {
        throw new Error(`Method ${name} not found`)
      }

      try {
        // Execute the operation
        const response = await this.httpClient.executeOperation(operation, params)

        // Convert response to MCP format
        return {
          content: [
            {
              type: 'text', // currently this is the only type that seems to be used by mcp server
              text: JSON.stringify(response.data), // TODO: pass through the http status code text?
            },
          ],
        }
      } catch (error) {
        console.error('Error in tool call', error)
        if (error instanceof HttpClientError) {
          console.error('HttpClientError encountered, returning structured error', error)
          const data = error.data?.response?.data ?? error.data ?? {}
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error', // TODO: get this from http status code?
                  ...(typeof data === 'object' ? data : { data: data }),
                }),
              },
            ],
          }
        }
        throw error
      }
    })
  }

  private findOperation(operationId: string): (OpenAPIV3.OperationObject & { method: string; path: string }) | null {
    return this.openApiLookup[operationId] ?? null
  }

  private parseHeaders(): Record<string, string> {
    // Prefer config over environment variables for remote operation
    const apiKey = this.config?.notionApiKey || process.env.NOTION_API_KEY
    const apiVersion = this.config?.notionApiVersion || process.env.NOTION_API_VERSION || '2022-06-28'

    if (!apiKey) {
      console.warn('NOTION_API_KEY must be provided via config or environment variable')
      return {}
    }

    return {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': apiVersion
    }
  }

  private getContentType(headers: Headers): 'text' | 'image' | 'binary' {
    const contentType = headers.get('content-type')
    if (!contentType) return 'binary'

    if (contentType.includes('text') || contentType.includes('json')) {
      return 'text'
    } else if (contentType.includes('image')) {
      return 'image'
    }
    return 'binary'
  }

  private truncateToolName(name: string): string {
    if (name.length <= 64) {
      return name;
    }
    return name.slice(0, 64);
  }

  async connect(transport: Transport) {
    // The SDK will handle stdio communication
    await this.server.connect(transport)
  }

  getServer() {
    return this.server
  }

  // Public method to list tools (for HTTP/REST endpoints)
  async listTools() {
    const tools: Tool[] = []
    Object.entries(this.tools).forEach(([toolName, def]) => {
      def.methods.forEach(method => {
        const toolNameWithMethod = `${toolName}-${method.name}`
        const truncatedToolName = this.truncateToolName(toolNameWithMethod)
        tools.push({
          name: truncatedToolName,
          description: method.description,
          inputSchema: method.inputSchema as Tool['inputSchema'],
        })
      })
    })
    return { tools }
  }

  // Public method to call a tool (for HTTP/REST endpoints)
  async callTool(name: string, args: Record<string, any>) {
    const operation = this.findOperation(name)
    if (!operation) {
      throw new Error(`Method ${name} not found`)
    }

    try {
      const response = await this.httpClient.executeOperation(operation, args)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data),
          },
        ],
      }
    } catch (error) {
      console.error('Error in tool call', error)
      if (error instanceof HttpClientError) {
        const data = error.data?.response?.data ?? error.data ?? {}
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                ...(typeof data === 'object' ? data : { data: data }),
              }),
            },
          ],
        }
      }
      throw error
    }
  }
}
