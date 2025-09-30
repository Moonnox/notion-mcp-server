# Notion MCP Server

![notion-mcp-sm](https://github.com/user-attachments/assets/6c07003c-8455-4636-b298-d60ffdf46cd8)

This project implements an [MCP server](https://spec.modelcontextprotocol.io/) for the [Notion API](https://developers.notion.com/reference/intro). 

![mcp-demo](https://github.com/user-attachments/assets/e3ff90a7-7801-48a9-b807-f7dd47f0d3d6)

## MCP Compliance

This server is fully compliant with the Model Context Protocol (MCP) specification:

- **MCP SDK**: Built on `@modelcontextprotocol/sdk` version 1.8.0
- **Transport Support**: 
  - Stdio transport for local execution
  - SSE (Server-Sent Events) transport for remote connections
- **Protocol Features**:
  - Tool listing and discovery
  - Tool execution with structured input/output
  - Error handling and status reporting
  - Multiple concurrent connections (remote mode)
- **Configuration**:
  - Environment variables (stdio mode)
  - Query parameters (remote mode)
  - Per-connection configuration support

For remote deployment information, see [REMOTE_DEPLOYMENT.md](./REMOTE_DEPLOYMENT.md).

### Installation

#### 1. Setting up Integration in Notion:
Go to [https://www.notion.so/profile/integrations](https://www.notion.so/profile/integrations) and create a new **internal** integration or select an existing one.

![Creating a Notion Integration token](docs/images/integrations-creation.png)

While we limit the scope of Notion API's exposed (for example, you will not be able to delete databases via MCP), there is a non-zero risk to workspace data by exposing it to LLMs. Security-conscious users may want to further configure the Integration's _Capabilities_. 

For example, you can create a read-only integration token by giving only "Read content" access from the "Configuration" tab:

![Notion Integration Token Capabilities showing Read content checked](docs/images/integrations-capabilities.png)

#### 2. Connecting content to integration:
Ensure relevant pages and databases are connected to your integration.

To do this, you'll need to visit that page, and click on the 3 dots, and select "Connect to integration". 

![Adding Integration Token to Notion Connections](docs/images/connections.png)

#### 3. Adding MCP config to your client:

##### Using npm:
Add the following to your `.cursor/mcp.json` or `claude_desktop_config.json` (MacOS: `~/Library/Application\ Support/Claude/claude_desktop_config.json`)

```javascript
{
  "mcpServers": {
    "notionApi": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "NOTION_API_KEY": "ntn_****",
        "NOTION_API_VERSION": "2022-06-28"  // Optional, defaults to 2022-06-28
      }
    }
  }
}
```

##### Using Docker:

There are three options for running the MCP server with Docker:

###### Option 1: Using the official Docker Hub image (stdio mode):

Add the following to your `.cursor/mcp.json` or `claude_desktop_config.json`:

```javascript
{
  "mcpServers": {
    "notionApi": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e", "NOTION_API_KEY",
        "-e", "NOTION_API_VERSION",
        "mcp/notion"
      ],
      "env": {
        "NOTION_API_KEY": "ntn_****",
        "NOTION_API_VERSION": "2022-06-28"  // Optional, defaults to 2022-06-28
      }
    }
  }
}
```

This approach:
- Uses the official Docker Hub image
- Uses simple environment variables for configuration
- Provides a more reliable configuration method

###### Option 2: Building the Docker image locally (stdio mode):

You can also build and run the Docker image locally. First, build the Docker image:

```bash
docker-compose build
```

Then, add the following to your `.cursor/mcp.json` or `claude_desktop_config.json`:

```javascript
{
  "mcpServers": {
    "notionApi": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e", "NOTION_API_KEY=ntn_****",
        "-e", "NOTION_API_VERSION=2022-06-28",  # Optional, defaults to 2022-06-28
        "notion-mcp-server"
      ]
    }
  }
}
```

###### Option 3: Remote MCP Server (HTTP/SSE mode):

For remote connections, you can run the server in HTTP mode with SSE transport. This allows multiple clients to connect and pass configuration via query parameters.

First, start the remote server:

```bash
docker-compose up notion-mcp-server-remote
```

Or run directly with Docker:

```bash
docker run -p 3000:3000 notion-mcp-server node build/scripts/start-remote-server.js
```

The server will start on port 3000 (configurable via PORT environment variable).

Then, configure your MCP client to connect remotely:

```javascript
{
  "mcpServers": {
    "notionApi": {
      "url": "http://localhost:3000/sse",
      "queryParams": {
        "notionApiKey": "ntn_****",
        "baseUrl": "https://api.notion.com",
        "notionApiVersion": "2022-06-28"
      }
    }
  }
}
```

**Query Parameters:**
- `notionApiKey` (required): Your Notion integration API key
- `baseUrl` (optional): Notion API base URL (default: https://api.notion.com)
- `notionApiVersion` (optional): Notion API version (default: 2022-06-28)

**Benefits of Remote Mode:**
- Multiple clients can connect simultaneously
- Configuration per connection (each client can use different API keys)
- No need to restart server for different configurations
- Suitable for cloud deployments
- Health check endpoint at `/health`

**Security Note:** When running in remote mode, ensure proper network security measures are in place, especially if exposing the server to the internet. Consider using HTTPS, authentication middleware, and firewall rules.

Don't forget to replace `ntn_****` with your integration secret. Find it from your integration configuration tab:

![Copying your Integration token from the Configuration tab in the developer portal](https://github.com/user-attachments/assets/67b44536-5333-49fa-809c-59581bf5370a)


#### Installing via Smithery

[![smithery badge](https://smithery.ai/badge/@makernotion/notion-mcp-server)](https://smithery.ai/server/@makernotion/notion-mcp-server)

To install Notion API Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@makernotion/notion-mcp-server):

```bash
npx -y @smithery/cli install @makernotion/notion-mcp-server --client claude
```

#### Configuration Examples

For more configuration examples including remote mode, Docker, and multiple workspace setups, see [mcp-config-examples.json](./mcp-config-examples.json).

### Examples

1. Using the following instruction
```
Comment "Hello MCP" on page "Getting started"
```

AI will correctly plan two API calls, `v1/search` and `v1/comments`, to achieve the task

2. Similarly, the following instruction will result in a new page named "Notion MCP" added to parent page "Development"
```
Add a page titled "Notion MCP" to page "Development"
```

3. You may also reference content ID directly
```
Get the content of page 1a6b35e6e67f802fa7e1d27686f017f2
```

### Development

#### Build

```bash
npm run build
```

#### Execute (stdio mode)

```bash
npx -y --prefix /path/to/local/notion-mcp-server @notionhq/notion-mcp-server
```

#### Run Remote Server (development)

```bash
npm run dev:remote
```

This will start the remote MCP server on port 3000 with hot-reload enabled. Connect to it at:
```
http://localhost:3000/sse?notionApiKey=YOUR_KEY&baseUrl=https://api.notion.com&notionApiVersion=2022-06-28
```

#### Testing Remote Server

Once the remote server is running, you can test it:

```bash
# Health check
curl http://localhost:3000/health

# Test SSE connection (requires MCP client or tool)
curl "http://localhost:3000/sse?notionApiKey=YOUR_KEY&notionApiVersion=2022-06-28"
```

#### Publish

```bash
npm publish --access public
```

