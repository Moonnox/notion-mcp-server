# Google Cloud Run Deployment Guide

This guide provides step-by-step instructions for deploying the Notion MCP Server to Google Cloud Run.

## Prerequisites

1. **Google Cloud Project**: You need an active GCP project
2. **gcloud CLI**: Install and configure the [gcloud CLI](https://cloud.google.com/sdk/docs/install)
3. **Authentication**: Run `gcloud auth login` and `gcloud config set project YOUR_PROJECT_ID`
4. **APIs Enabled**: 
   - Cloud Run API
   - Cloud Build API
   - Container Registry API

## Quick Deploy

### Step 1: Build and Push to Container Registry

```bash
# Set your project ID
export PROJECT_ID=your-project-id
gcloud config set project $PROJECT_ID

# Build and push using Cloud Build
gcloud builds submit --config cloudbuild.yaml
```

### Step 2: Deploy to Cloud Run

```bash
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

## Important Configuration

### Critical Parameters

- `--command=node` - Override the default entrypoint
- `--args=build/scripts/start-remote-server.js` - Run the remote server (not stdio)
- `--port=3000` - Must match the PORT environment variable
- `--timeout=60` - Request timeout (increase if needed)

### Why These Are Required

The default Dockerfile CMD starts the stdio server (`bin/cli.mjs`), which doesn't listen on a port. Cloud Run requires a server that:
1. Listens on the port specified by the `PORT` environment variable (3000)
2. Responds to HTTP health checks
3. Starts within the timeout period

## Environment Variables

The remote server on Cloud Run does NOT use environment variables for Notion configuration. Instead, configuration is passed via query parameters when clients connect:

```
https://your-service-url.run.app/sse?notionApiKey=YOUR_KEY&baseUrl=https://api.notion.com&notionApiVersion=2022-06-28
```

## Testing Your Deployment

### 1. Get Your Service URL

```bash
gcloud run services describe notion-mcp-server \
  --region us-central1 \
  --format='value(status.url)'
```

### 2. Test Health Endpoint

```bash
curl https://YOUR_SERVICE_URL/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2025-09-30T12:00:00.000Z"}
```

### 3. Configure MCP Client

```json
{
  "mcpServers": {
    "notionApi": {
      "url": "https://YOUR_SERVICE_URL/sse",
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

## Troubleshooting

### Error: Container failed to start

**Problem**: "The user-provided container failed to start and listen on the port"

**Solutions**:

1. **Verify command and args are set correctly**:
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

2. **Check logs**:
   ```bash
   gcloud run services logs read notion-mcp-server \
     --region us-central1 \
     --limit 50
   ```

3. **Verify PORT environment variable**:
   ```bash
   gcloud run services describe notion-mcp-server \
     --region us-central1 \
     --format='yaml(spec.template.spec.containers[0].env)'
   ```

### Error: BUILD FAILED (BuildKit)

**Problem**: Google Cloud Build doesn't support BuildKit mount caching

**Solution**: Use the standard `Dockerfile` (not `Dockerfile.buildkit`)

The main `Dockerfile` has been updated to work without BuildKit features.

### Error: 404 Not Found on /sse

**Problem**: Accessing the wrong endpoint

**Solution**: Ensure you're connecting to `/sse` with required query parameters:
```
https://YOUR_SERVICE_URL/sse?notionApiKey=YOUR_KEY
```

### Error: Missing notionApiKey

**Problem**: Query parameter not provided

**Solution**: Always include `notionApiKey` in the connection URL:
```json
{
  "url": "https://YOUR_SERVICE_URL/sse",
  "queryParams": {
    "notionApiKey": "ntn_your_key"
  }
}
```

## Updating Your Deployment

### Deploy New Version

```bash
# Build new image
gcloud builds submit --config cloudbuild.yaml

# Deploy with zero-downtime
gcloud run deploy notion-mcp-server \
  --image gcr.io/$PROJECT_ID/notion-mcp-server:latest \
  --region us-central1
```

Cloud Run automatically performs zero-downtime deployments.

### Rollback to Previous Version

```bash
# List revisions
gcloud run revisions list \
  --service notion-mcp-server \
  --region us-central1

# Rollback to specific revision
gcloud run services update-traffic notion-mcp-server \
  --to-revisions=notion-mcp-server-00001=100 \
  --region us-central1
```

## Cost Optimization

### Recommended Settings for Light Usage

```bash
gcloud run deploy notion-mcp-server \
  --min-instances 0 \
  --max-instances 2 \
  --memory 256Mi \
  --cpu 1 \
  --concurrency 10
```

### Recommended Settings for Production

```bash
gcloud run deploy notion-mcp-server \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80
```

## Security Best Practices

### 1. Restrict Access

Instead of `--allow-unauthenticated`, use IAM:

```bash
gcloud run deploy notion-mcp-server \
  --no-allow-unauthenticated \
  --region us-central1

# Grant access to specific users
gcloud run services add-iam-policy-binding notion-mcp-server \
  --member='user:email@example.com' \
  --role='roles/run.invoker' \
  --region us-central1
```

### 2. Use Secret Manager for API Keys

Store Notion API keys in Secret Manager:

```bash
# Create secret
echo -n "ntn_your_api_key" | gcloud secrets create notion-api-key --data-file=-

# Grant Cloud Run access
gcloud secrets add-iam-policy-binding notion-api-key \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Then modify the remote server to optionally read from Secret Manager.

### 3. Enable VPC Connector

For enhanced security, deploy within a VPC:

```bash
gcloud run deploy notion-mcp-server \
  --vpc-connector your-vpc-connector \
  --vpc-egress all-traffic \
  --region us-central1
```

## Monitoring

### Enable Cloud Logging

Logs are automatically sent to Cloud Logging. View them:

```bash
gcloud run services logs read notion-mcp-server \
  --region us-central1 \
  --follow
```

### Set Up Alerts

Create an alert for service availability:

```bash
# Create notification channel first
gcloud alpha monitoring channels create \
  --display-name="Email Notification" \
  --type=email \
  --channel-labels=email_address=your-email@example.com

# Create alert policy for high error rate
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Cloud Run Error Rate" \
  --condition-display-name="Error rate too high" \
  --condition-threshold-value=0.05 \
  --condition-threshold-duration=60s
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: google-github-actions/setup-gcloud@v1
        with:
          project_id: ${{ secrets.GCP_PROJECT_ID }}
          service_account_key: ${{ secrets.GCP_SA_KEY }}
      
      - name: Build and Deploy
        run: |
          gcloud builds submit --config cloudbuild.yaml
          gcloud run deploy notion-mcp-server \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/notion-mcp-server:latest \
            --region us-central1 \
            --command=node \
            --args=build/scripts/start-remote-server.js
```

## Support

For issues specific to Cloud Run deployment:
1. Check [Cloud Run Documentation](https://cloud.google.com/run/docs)
2. Review [Cloud Run Troubleshooting](https://cloud.google.com/run/docs/troubleshooting)
3. Post in [Stack Overflow with 'google-cloud-run' tag](https://stackoverflow.com/questions/tagged/google-cloud-run)

For Notion MCP Server issues:
- GitHub Issues: [notion-mcp-server/issues](https://github.com/makenotion/notion-mcp-server/issues)

---

**Last Updated**: September 30, 2025

