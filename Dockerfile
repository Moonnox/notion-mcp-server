# Dockerfile for Notion MCP Server (Remote Mode)
# Uses tsx to run TypeScript directly without compilation
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including tsx for running TypeScript)
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Set default environment variables
ENV NOTION_API_VERSION="2022-06-28"
ENV PORT=3000
ENV NODE_ENV=production

# Expose port for remote connections
EXPOSE 3000

# Run remote server with tsx (no build needed)
CMD ["npx", "tsx", "scripts/start-remote-server.ts"]
