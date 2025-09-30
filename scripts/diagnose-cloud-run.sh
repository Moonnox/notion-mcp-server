#!/bin/bash
# Diagnostic script for Cloud Run deployment issues

set -e

PROJECT_ID=${1:-$(gcloud config get-value project)}
SERVICE_NAME="notion-mcp-server"
REGION="us-central1"

echo "======================================"
echo "Cloud Run Deployment Diagnostics"
echo "======================================"
echo "Project: $PROJECT_ID"
echo "Service: $SERVICE_NAME"
echo "Region: $REGION"
echo ""

echo "1. Checking service configuration..."
echo "--------------------------------------"
gcloud run services describe $SERVICE_NAME \
  --region $REGION \
  --format='yaml(spec.template.spec.containers[0].command, spec.template.spec.containers[0].args, spec.template.spec.containers[0].env, spec.template.spec.containers[0].ports)' \
  2>/dev/null || echo "Service not found or not configured"

echo ""
echo "2. Checking latest revision logs..."
echo "--------------------------------------"
gcloud run services logs read $SERVICE_NAME \
  --region $REGION \
  --limit 20 \
  2>/dev/null || echo "No logs available"

echo ""
echo "3. Checking image in container registry..."
echo "--------------------------------------"
IMAGE="gcr.io/$PROJECT_ID/notion-mcp-server:latest"
gcloud container images describe $IMAGE 2>/dev/null || echo "Image not found: $IMAGE"

echo ""
echo "4. Testing image locally..."
echo "--------------------------------------"
echo "Pulling image: $IMAGE"
docker pull $IMAGE 2>/dev/null || echo "Failed to pull image"

echo ""
echo "Testing with remote server command..."
docker run --rm -d -p 3001:3000 --name test-notion-mcp \
  -e PORT=3000 \
  $IMAGE node build/scripts/start-remote-server.js 2>/dev/null || echo "Failed to start container"

if docker ps | grep -q test-notion-mcp; then
  echo "Container started successfully!"
  sleep 3
  echo "Testing health endpoint..."
  curl -s http://localhost:3001/health || echo "Health check failed"
  echo ""
  docker logs test-notion-mcp
  docker stop test-notion-mcp
else
  echo "Container failed to start. Checking logs..."
  docker logs test-notion-mcp 2>/dev/null || echo "No logs available"
  docker rm test-notion-mcp 2>/dev/null || true
fi

echo ""
echo "======================================"
echo "Diagnosis complete!"
echo "======================================"

