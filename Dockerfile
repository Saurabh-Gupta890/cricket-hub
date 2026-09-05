# 🏏 Production Dockerfile for CricketHub
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install production dependencies first (caching layer)
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .

# Ensure data directory exists and assign permissions
RUN mkdir -p /app/data/matches && chown -R node:node /app

# Run as non-root user for security
USER node

# Expose server port
EXPOSE 3000

# Healthcheck probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Environment Defaults
ENV NODE_ENV=production
ENV PORT=3000

# Start command
CMD ["node", "server.js"]
