#!/bin/bash
# Script to fix and redeploy to Cloud Run with correct configuration

set -e

PROJECT_ID=${1:-$(gcloud config get-value project)}
SERVICE_NAME="notion-mcp-server"
REGION="us-central1"
IMAGE="gcr.io/$PROJECT_ID/$SERVICE_NAME:latest"

echo "======================================"
echo "Fixing Cloud Run Deployment"
echo "======================================"
echo "Project: $PROJECT_ID"
echo "Service: $SERVICE_NAME"
echo "Image: $IMAGE"
echo "Region: $REGION"
echo ""

# Check if image exists
echo "1. Verifying image exists..."
if ! gcloud container images describe $IMAGE &>/dev/null; then
  echo "ERROR: Image not found. Please build first:"
  echo "  gcloud builds submit --config cloudbuild.yaml"
  exit 1
fi
echo "✓ Image found"

# Delete existing service to start fresh
echo ""
echo "2. Removing existing service (if any)..."
gcloud run services delete $SERVICE_NAME \
  --region $REGION \
  --quiet 2>/dev/null || echo "No existing service found"

# Deploy with correct configuration
echo ""
echo "3. Deploying with correct configuration..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 10 \
  --timeout 60 \
  --set-env-vars "NODE_ENV=production,PORT=3000"

# Get service URL
echo ""
echo "4. Getting service URL..."
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
  --region $REGION \
  --format='value(status.url)')

echo ""
echo "======================================"
echo "Deployment Complete!"
echo "======================================"
echo "Service URL: $SERVICE_URL"
echo ""
echo "Testing endpoints..."
echo "Health check: $SERVICE_URL/health"
curl -s $SERVICE_URL/health || echo "Health check failed"
echo ""
echo ""
echo "SSE endpoint: $SERVICE_URL/sse?notionApiKey=YOUR_KEY"
echo ""
echo "To test with your Notion API key:"
echo "curl \"$SERVICE_URL/sse?notionApiKey=YOUR_KEY&notionApiVersion=2022-06-28\""

