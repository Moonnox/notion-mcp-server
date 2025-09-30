# Remote MCP Server Deployment Guide

This guide explains how to deploy the Notion MCP Server in remote mode for production use.

## Overview

The remote mode allows the Notion MCP Server to run as an HTTP service with SSE (Server-Sent Events) transport, enabling:
- Multiple simultaneous client connections
- Per-connection configuration via query parameters
- Cloud deployment compatibility
- Scalable architecture

## Architecture

```
┌─────────────┐      HTTP/SSE       ┌──────────────────┐      HTTPS      ┌─────────────┐
│ MCP Client  │ ◄──────────────────► │ MCP Remote       │ ◄──────────────► │   Notion    │
│  (Cursor,   │    Query Params      │ Server           │    API Calls     │     API     │
│  Claude)    │                      │                  │                  │             │
└─────────────┘                      └──────────────────┘                  └─────────────┘
                                            │
                                            ▼
                                     ┌──────────────┐
                                     │  OpenAPI     │
                                     │  Spec        │
                                     └──────────────┘
```

## Deployment Options

### 1. Local Development

Start the remote server locally:

```bash
npm run dev:remote
```

Or build and run:

```bash
npm run build
node bin/remote-server.mjs
```

The server will be available at `http://localhost:3000/sse`

### 2. Docker Deployment

#### Using Docker Compose

```bash
# Start the remote server (default mode)
docker-compose up notion-mcp-server

# Or run in detached mode
docker-compose up -d notion-mcp-server

# View logs
docker-compose logs -f notion-mcp-server

# Stop the server
docker-compose down
```

#### Using Docker CLI

```bash
# Build the image
docker build -t notion-mcp-server .

# Run the remote server (default mode)
docker run -p 3000:3000 \
  --name notion-mcp-remote \
  notion-mcp-server

# Run in detached mode
docker run -d -p 3000:3000 \
  --restart unless-stopped \
  --name notion-mcp-remote \
  notion-mcp-server

# For stdio mode, override the command
docker run -i --rm \
  -e NOTION_API_KEY=your_key \
  notion-mcp-server \
  bin/cli.mjs
```

### 3. Cloud Deployment

#### Prerequisites
- Container orchestration platform (Kubernetes, ECS, Cloud Run, etc.)
- Load balancer with SSL/TLS support
- Health check monitoring

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `3000` |
| `NODE_ENV` | Node environment | `production` |

#### Kubernetes Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notion-mcp-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notion-mcp-server
  template:
    metadata:
      labels:
        app: notion-mcp-server
    spec:
      containers:
      - name: notion-mcp-server
        image: your-registry/notion-mcp-server:latest
        command: ["node", "build/scripts/start-remote-server.js"]
        ports:
        - containerPort: 3000
        env:
        - name: PORT
          value: "3000"
        - name: NODE_ENV
          value: "production"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: notion-mcp-server
spec:
  selector:
    app: notion-mcp-server
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

#### Google Cloud Run Example

The repository includes a `cloudbuild.yaml` configuration for automated builds in Google Cloud Build.

**Option 1: Using Cloud Build (Recommended)**

```bash
# Submit build to Cloud Build
gcloud builds submit --config cloudbuild.yaml

# Deploy to Cloud Run
gcloud run deploy notion-mcp-server \
  --image gcr.io/YOUR_PROJECT_ID/notion-mcp-server:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars=NODE_ENV=production,PORT=3000 \
  --timeout=60
```

**Option 2: Direct build and deploy**

```bash
# Build and push image
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/notion-mcp-server

# Deploy to Cloud Run
gcloud run deploy notion-mcp-server \
  --image gcr.io/YOUR_PROJECT_ID/notion-mcp-server \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars=NODE_ENV=production,PORT=3000 \
  --timeout=60
```

**Note**: The standard `Dockerfile` is compatible with Google Cloud Build. If you need BuildKit features for faster local builds, use `Dockerfile.buildkit` instead:

```bash
# Local BuildKit build
DOCKER_BUILDKIT=1 docker build -f Dockerfile.buildkit -t notion-mcp-server .
```

#### AWS ECS Example

See [AWS ECS Documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/docker-basics.html) for deploying Docker containers.

## Security Considerations

### 1. Network Security

- **Use HTTPS**: Always use SSL/TLS in production
- **Firewall Rules**: Restrict access to trusted IP ranges
- **VPN/VPC**: Deploy within a private network when possible
- **Rate Limiting**: Implement rate limiting at the load balancer level

### 2. API Key Management

- **Never hardcode API keys**: Always pass via query parameters
- **Secure transmission**: Ensure HTTPS for query parameter encryption
- **Rotation**: Implement API key rotation policies
- **Audit logging**: Log all API key usage

### 3. Authentication & Authorization

Consider adding middleware for:
- Bearer token authentication
- OAuth 2.0 integration
- JWT validation
- IP whitelisting

Example middleware:

```javascript
app.use('/sse', (req, res, next) => {
  const authToken = req.headers.authorization;
  if (!authToken || !isValidToken(authToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

### 4. CORS Configuration

Update CORS settings for production:

```javascript
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://your-domain.com');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // ... rest of CORS config
});
```

## Monitoring & Observability

### Health Checks

The server exposes a health check endpoint:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-09-30T12:00:00.000Z"
}
```

### Logging

The server logs:
- Connection attempts
- Configuration parameters (sanitized)
- Errors and warnings
- Request/response metrics

### Metrics

Consider implementing:
- Connection count
- Request latency
- Error rates
- API call success/failure rates

## Client Configuration

### MCP Client Setup

```json
{
  "mcpServers": {
    "notionApi": {
      "url": "https://your-domain.com/sse",
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

### Query Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `notionApiKey` | Yes | Notion integration API key | - |
| `baseUrl` | No | Notion API base URL | `https://api.notion.com` |
| `notionApiVersion` | No | Notion API version | `2022-06-28` |

## Troubleshooting

### Connection Issues

1. **Check health endpoint**: `curl http://your-server/health`
2. **Verify query parameters**: Ensure all required params are provided
3. **Check logs**: Review server logs for error messages
4. **Network connectivity**: Ensure client can reach the server

### API Key Errors

- Verify the API key is valid
- Check Notion integration permissions
- Ensure the key hasn't been revoked

### Performance Issues

- Monitor server resources (CPU, memory)
- Check for network latency
- Review API call patterns
- Consider scaling horizontally

## Scaling

### Horizontal Scaling

The remote server is stateless and can be scaled horizontally:

```bash
# Docker Compose
docker-compose up --scale notion-mcp-server-remote=3

# Kubernetes
kubectl scale deployment notion-mcp-server --replicas=5
```

### Load Balancing

Use a load balancer to distribute traffic:
- AWS Application Load Balancer
- Google Cloud Load Balancing
- Nginx
- HAProxy

### Caching

Consider implementing caching for:
- OpenAPI spec loading
- Frequently accessed Notion data
- Tool definitions

## Best Practices

1. **Keep dependencies updated**: Regular security updates
2. **Monitor logs**: Set up centralized logging
3. **Implement alerting**: Alert on errors and performance issues
4. **Backup configurations**: Version control all configurations
5. **Test before deploy**: Thorough testing in staging environment
6. **Document changes**: Keep deployment documentation current
7. **Use infrastructure as code**: Terraform, CloudFormation, etc.

## Support

For issues and questions:
- GitHub Issues: [notion-mcp-server/issues](https://github.com/makenotion/notion-mcp-server/issues)
- Documentation: [README.md](./README.md)
- MCP Specification: [modelcontextprotocol.io](https://modelcontextprotocol.io)

