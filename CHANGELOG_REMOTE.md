# Remote MCP Server Implementation - Changelog

## Summary

This update adds full remote server capability to the Notion MCP Server, allowing it to run as an HTTP service with SSE (Server-Sent Events) transport. Configuration parameters (`notionApiKey`, `baseUrl`, `notionApiVersion`) can now be passed as query parameters for each connection.

## Key Features

### ✅ Remote Server Support
- **HTTP/SSE Transport**: Full implementation of SSE transport for remote MCP connections
- **Query Parameter Configuration**: All configuration can be passed via URL query parameters
- **Multiple Concurrent Connections**: Supports multiple clients simultaneously with different configurations
- **Health Monitoring**: `/health` endpoint for monitoring and health checks

### ✅ MCP Compliance
- Built on `@modelcontextprotocol/sdk` version 1.8.0
- Fully compliant with MCP specification
- Supports both stdio and SSE transports
- Per-connection configuration support

### ✅ Backward Compatibility
- Existing stdio mode remains fully functional
- Environment variable configuration still supported
- No breaking changes to existing deployments

## New Files Created

### 1. `/scripts/start-remote-server.ts`
- Express-based HTTP server with SSE transport
- Query parameter parsing and validation
- CORS support for remote connections
- Health check endpoint
- Graceful shutdown handling

### 2. `/scripts/build-remote-cli.js`
- Build script for remote server binary
- Creates executable `bin/remote-server.mjs`

### 3. `/REMOTE_DEPLOYMENT.md`
- Comprehensive deployment guide
- Docker, Kubernetes, and cloud deployment examples
- Security best practices
- Monitoring and troubleshooting guide

### 4. `/mcp-config-examples.json`
- Multiple configuration examples
- Stdio and remote mode configurations
- Multi-workspace setup examples

### 5. `/CHANGELOG_REMOTE.md`
- This document

## Modified Files

### 1. `/src/init-server.ts`
- Added `MCPProxyConfig` interface import
- Added `initProxyWithConfig()` function for configuration-based initialization
- Maintains backward compatibility with existing `initProxy()` function

### 2. `/src/openapi-mcp-server/mcp/proxy.ts`
- Added `MCPProxyConfig` interface
- Updated constructor to accept optional configuration parameter
- Modified `parseHeaders()` to support both config and environment variables
- Prioritizes config over environment variables when both are present

### 3. `/package.json`
- Added `dev:remote` script for remote server development
- Updated build script to include remote server binary
- Added `notion-mcp-server-remote` binary entry point

### 4. `/Dockerfile`
- Updated to support both stdio and remote modes
- Added PORT and NODE_ENV environment variables
- Exposed port 3000 for remote connections
- Flexible CMD/ENTRYPOINT for different modes

### 5. `/docker-compose.yml`
- Split into two services:
  - `notion-mcp-server-stdio`: Traditional stdio mode
  - `notion-mcp-server-remote`: New remote HTTP/SSE mode
- Added health checks for remote mode
- Port mapping configuration

### 6. `/README.md`
- Added MCP Compliance section
- Added Option 3: Remote MCP Server instructions
- Updated Development section with remote server commands
- Added reference to REMOTE_DEPLOYMENT.md
- Added reference to mcp-config-examples.json

## Configuration

### Query Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `notionApiKey` | ✅ Yes | Notion integration API key | - |
| `baseUrl` | ❌ No | Notion API base URL | `https://api.notion.com` |
| `notionApiVersion` | ❌ No | Notion API version | `2022-06-28` |

### Environment Variables (Remote Mode)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `3000` |
| `NODE_ENV` | Node environment | `production` |

## Usage Examples

### 1. Local Development

```bash
npm run dev:remote
```

Connect to: `http://localhost:3000/sse?notionApiKey=YOUR_KEY`

### 2. Docker Compose

```bash
docker-compose up notion-mcp-server-remote
```

### 3. MCP Client Configuration

```json
{
  "mcpServers": {
    "notionApi": {
      "url": "http://localhost:3000/sse",
      "transport": "sse",
      "queryParams": {
        "notionApiKey": "ntn_your_api_key",
        "baseUrl": "https://api.notion.com",
        "notionApiVersion": "2022-06-28"
      }
    }
  }
}
```

## Benefits of Remote Mode

1. **Multiple Clients**: Support multiple concurrent connections
2. **Per-Connection Config**: Each client can use different API keys/settings
3. **No Server Restart**: Change configuration without restarting the server
4. **Cloud-Ready**: Deploy to any cloud platform (AWS, GCP, Azure, etc.)
5. **Scalable**: Horizontally scalable architecture
6. **Monitoring**: Built-in health checks and logging

## Security Considerations

⚠️ **Important**: When running in remote mode:

1. **Use HTTPS in production** - Query parameters should be encrypted
2. **Implement authentication** - Add authentication middleware if needed
3. **Network security** - Use firewalls, VPNs, or VPCs
4. **API key rotation** - Regularly rotate Notion API keys
5. **CORS configuration** - Restrict allowed origins in production

## Testing

### Health Check
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-09-30T12:00:00.000Z"
}
```

### SSE Connection
Requires an MCP client or compatible tool to test the SSE endpoint.

## Migration Guide

### From Stdio to Remote Mode

**Before (stdio mode):**
```json
{
  "mcpServers": {
    "notionApi": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "NOTION_API_KEY": "ntn_key"
      }
    }
  }
}
```

**After (remote mode):**
1. Start remote server:
   ```bash
   docker-compose up notion-mcp-server-remote
   ```

2. Update config:
   ```json
   {
     "mcpServers": {
       "notionApi": {
         "url": "http://localhost:3000/sse",
         "queryParams": {
           "notionApiKey": "ntn_key"
         }
       }
     }
   }
   ```

## Build & Deploy

### Build
```bash
npm run build
```

Outputs:
- `bin/cli.mjs` - Stdio mode CLI
- `bin/remote-server.mjs` - Remote mode CLI

### Run
```bash
# Stdio mode
notion-mcp-server

# Remote mode
notion-mcp-server-remote
```

## Future Enhancements

Potential future additions:
- [ ] WebSocket transport support
- [ ] Built-in authentication/authorization
- [ ] Rate limiting
- [ ] Request/response logging
- [ ] Metrics and analytics
- [ ] Multiple transport support in single server
- [ ] Auto-scaling capabilities

## Version Compatibility

- **Node.js**: >= 18.0.0
- **MCP SDK**: 1.8.0
- **Express**: 4.21.2
- **TypeScript**: 5.8.2

## Support

For issues, questions, or contributions:
- GitHub Issues: [notion-mcp-server/issues](https://github.com/makenotion/notion-mcp-server/issues)
- Documentation: [README.md](./README.md)
- Deployment Guide: [REMOTE_DEPLOYMENT.md](./REMOTE_DEPLOYMENT.md)

## License

MIT License - Same as the original project

---

**Last Updated**: September 30, 2025

