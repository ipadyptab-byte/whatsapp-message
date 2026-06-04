# =========================
# Build Stage
# =========================
FROM node:22-slim AS builder

WORKDIR /app

# Install build tools
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build backend
RUN npm run build

# Build dashboard (if dashboard/package.json exists)
RUN if [ -f dashboard/package.json ]; then \
      cd dashboard && npm ci && npm run build; \
    fi

# =========================
# Production Stage
# =========================
FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production

# Install Chromium dependencies for WhatsApp Web
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
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
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy backend build
COPY --from=builder /app/dist ./dist

# Copy dashboard build
COPY --from=builder /app/dashboard/dist ./dashboard/dist

# Create data folders
RUN mkdir -p \
    /app/data \
    /app/data/media \
    /app/data/sessions

EXPOSE 10000

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/main.js"]
