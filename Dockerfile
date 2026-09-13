# ═══════════════════════════════════════════════
#  CRICKETHUB MULTI-ENVIRONMENT DOCKERFILE
# ═══════════════════════════════════════════════

FROM node:20-alpine AS base
WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY server.js ./
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY src/ ./src/

# Ensure data directory exists with correct non-root permissions
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
