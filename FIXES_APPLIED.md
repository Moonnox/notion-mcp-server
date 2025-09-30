# Fixes Applied for Cloud Deployment Issues

## Issues Resolved

### 1. ✅ BuildKit Compatibility Issue (Google Cloud Build)

**Problem**: `--mount=type=cache` requires BuildKit, which Google Cloud Build doesn't support by default.

**Solution**:
- Removed BuildKit-specific features from main `Dockerfile`
- Created separate `Dockerfile.buildkit` for local development with BuildKit optimizations
- Standard `Dockerfile` now works with all Docker versions and cloud build systems

**Files Changed**:
- `Dockerfile` - Removed `--mount=type=cache` directives
- `Dockerfile.buildkit` - New file with BuildKit optimizations for local use
- `cloudbuild.yaml` - New automated build configuration for GCP

---

### 2. ✅ Cloud Run Container Startup Issue

**Problem**: Container failed to start on Cloud Run with error:
```
The user-provided container failed to start and listen on the port 
defined provided by the PORT=3000 environment variable
```

**Root Cause**: The default Docker CMD was `bin/cli.mjs` which starts the **stdio server** (for local MCP connections). This doesn't listen on any port. Cloud Run requires an HTTP server.

**Solution**: Deploy with explicit command override to run the **remote server**:

```bash
gcloud run deploy notion-mcp-server \
  --image gcr.io/PROJECT_ID/notion-mcp-server:latest \
  --command=node \
  --args=build/scripts/start-remote-server.js \
  --port=3000 \
  --set-env-vars=NODE_ENV=production,PORT=3000
```

**Files Changed**:
- `REMOTE_DEPLOYMENT.md` - Updated Cloud Run deployment commands
- `cloudbuild.yaml` - Added Cloud Run deployment step with correct command
- `CLOUD_RUN_DEPLOY.md` - New comprehensive Cloud Run guide

---

## How to Deploy Now

### Option 1: Quick Deploy (Recommended)

```bash
# 1. Set your project
export PROJECT_ID=your-gcp-project-id
gcloud config set project $PROJECT_ID

# 2. Build and push
gcloud builds submit --config cloudbuild.yaml

# 3. Deploy to Cloud Run with correct command
gcloud run deploy notion-mcp-server \
  --image gcr.io/$PROJECT_ID/notion-mcp-server:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars=NODE_ENV=production,PORT=3000 \
  --command=node \
  --args=build/scripts/start-remote-server.js \
  --timeout=60
```

### Option 2: Direct Build and Deploy

```bash
# Build and deploy in one step
gcloud builds submit --tag gcr.io/$PROJECT_ID/notion-mcp-server

# Deploy
gcloud run deploy notion-mcp-server \
  --image gcr.io/$PROJECT_ID/notion-mcp-server \
  --region us-central1 \
  --command=node \
  --args=build/scripts/start-remote-server.js \
  --port=3000 \
  --set-env-vars=PORT=3000
```

---

## Verification Steps

### 1. Check Deployment Status

```bash
gcloud run services describe notion-mcp-server \
  --region us-central1 \
  --format='get(status.url)'
```

### 2. Test Health Endpoint

```bash
SERVICE_URL=$(gcloud run services describe notion-mcp-server \
  --region us-central1 \
  --format='value(status.url)')

curl $SERVICE_URL/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2025-09-30T12:00:00.000Z"}
```

### 3. Verify Command Override

```bash
gcloud run services describe notion-mcp-server \
  --region us-central1 \
  --format='yaml(spec.template.spec.containers[0].command, spec.template.spec.containers[0].args)'
```

Should show:
```yaml
command:
- node
args:
- build/scripts/start-remote-server.js
```

---

## Key Differences Between Modes

### Stdio Mode (Local)
- Default Docker CMD
- Runs: `bin/cli.mjs`
- Uses: stdin/stdout for MCP communication
- For: Local MCP clients (Cursor, Claude Desktop)
- Config: Environment variables

### Remote Mode (Cloud)
- Override with `--command` and `--args`
- Runs: `build/scripts/start-remote-server.js`
- Uses: HTTP/SSE for MCP communication
- For: Remote/cloud deployments
- Config: Query parameters per connection

---

## Configuration for MCP Clients

Once deployed, configure your MCP client:

```json
{
  "mcpServers": {
    "notionApi": {
      "url": "https://your-service-url.run.app/sse",
      "transport": "sse",
      "queryParams": {
        "notionApiKey": "ntn_your_notion_api_key",
        "baseUrl": "https://api.notion.com",
        "notionApiVersion": "2022-06-28"
      }
    }
  }
}
```

**Important**: Replace `your-service-url.run.app` with your actual Cloud Run URL.

---

## New Files Created

1. **`Dockerfile.buildkit`** - BuildKit-optimized version for local development
2. **`cloudbuild.yaml`** - Automated build configuration for Google Cloud Build
3. **`CLOUD_RUN_DEPLOY.md`** - Comprehensive Cloud Run deployment guide
4. **`FIXES_APPLIED.md`** - This document

---

## Documentation Updates

- ✅ `README.md` - Added Cloud Run deployment link
- ✅ `REMOTE_DEPLOYMENT.md` - Updated with correct Cloud Run commands
- ✅ `Dockerfile` - Made compatible with all build systems
- ✅ `cloudbuild.yaml` - Complete automated build pipeline

---

## Troubleshooting

### Still Getting Container Startup Error?

Check these:

1. **Verify command override is set**:
   ```bash
   gcloud run services describe notion-mcp-server \
     --region us-central1 | grep -A5 "containers:"
   ```

2. **Check recent logs**:
   ```bash
   gcloud run services logs read notion-mcp-server \
     --region us-central1 \
     --limit 50
   ```

3. **Ensure PORT environment variable is set to 3000**:
   ```bash
   gcloud run services describe notion-mcp-server \
     --region us-central1 | grep -A10 "env:"
   ```

### Need More Help?

- **Cloud Run specific**: See [CLOUD_RUN_DEPLOY.md](./CLOUD_RUN_DEPLOY.md)
- **General remote deployment**: See [REMOTE_DEPLOYMENT.md](./REMOTE_DEPLOYMENT.md)
- **GitHub Issues**: [notion-mcp-server/issues](https://github.com/makenotion/notion-mcp-server/issues)

---

**Last Updated**: September 30, 2025

