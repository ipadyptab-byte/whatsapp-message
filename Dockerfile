# OpenWA - Dockerfile
# Production Docker image for Render
# Includes Node.js, Chromium/Puppeteer, API and React dashboard

# ============================================================
# Stage 1: Builder
# ============================================================
FROM node:22-slim AS builder

WORKDIR /app

# Build dependencies required by native Node modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy application source
COPY . .

# Build NestJS backend
RUN npm run build

# Build React dashboard
RUN npm run dashboard:build


# ============================================================
# Stage 2: Production
# ============================================================
FROM node:22-slim AS production

WORKDIR /app

# ============================================================
# Install Chromium and required runtime dependencies
# ============================================================
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    dumb-init \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*


# ============================================================
# Puppeteer / Chromium configuration
# ============================================================
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Chromium/Puppeteer settings suitable for containers
ENV PUPPETEER_HEADLESS=true


# ============================================================
# Create application user
# ============================================================
RUN groupadd -r openwa && \
    useradd -r -g openwa -d /app -s /usr/sbin/nologin openwa


# ============================================================
# Copy package files
# ============================================================
COPY package*.json ./


# ============================================================
# Install production dependencies
# ============================================================
RUN npm ci --omit=dev && \
    npm cache clean --force


# ============================================================
# Copy compiled backend
# ============================================================
COPY --from=builder /app/dist ./dist


# ============================================================
# Copy compiled React dashboard
# ============================================================
COPY --from=builder /app/dashboard/dist ./dashboard/dist


# ============================================================
# Create persistent data directories
#
# Render Persistent Disk should be mounted at:
# /data
#
# Database:
# /data/openwa.sqlite
#
# WhatsApp sessions:
# /data/sessions
#
# Media:
# /data/media
#
# Plugins:
# /data/plugins
# ============================================================
RUN mkdir -p \
    /data/sessions \
    /data/media \
    /data/plugins \
    && chown -R openwa:openwa /app /data


# ============================================================
# Runtime environment
# ============================================================
ENV NODE_ENV=production

# Render provides PORT automatically.
# Application defaults to 2785 if PORT is not provided.
ENV PORT=10000

# Data locations
ENV DATABASE_TYPE=sqlite
ENV DATABASE_NAME=/data/openwa.sqlite

ENV SESSION_DATA_PATH=/data/sessions

ENV STORAGE_TYPE=local
ENV STORAGE_LOCAL_PATH=/data/media

ENV PLUGINS_DIR=/data/plugins


# ============================================================
# Render listens on PORT 10000
# ============================================================
EXPOSE 10000


# ============================================================
# Health check
#
# Uses the PORT environment variable so the health check
# remains compatible with Render.
# ============================================================
HEALTHCHECK \
    --interval=30s \
    --timeout=10s \
    --start-period=60s \
    --retries=5 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT || 10000)+'/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"


# ============================================================
# Start application
# ============================================================
ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/main"]
