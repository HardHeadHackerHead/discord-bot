# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies needed for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev for build)
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Install Remotion sub-project dependencies (credits video renderer)
RUN cd src/modules/stream-credits/credits-video && npm install --omit=dev

# Build TypeScript
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --omit=dev

# Stage 2: Production
FROM node:22-slim

WORKDIR /app

# Install runtime dependencies for native modules, FFmpeg for audio processing, ngrok for tunneling,
# and Chromium dependencies for Remotion video rendering
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    openssl \
    ffmpeg \
    curl \
    unzip \
    # Chromium dependencies for Remotion headless rendering
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*


# Copy package files (for reference)
COPY package*.json ./

# Copy node_modules from builder (already pruned to production only)
COPY --from=builder /app/node_modules ./node_modules

# Copy prisma files and generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy Remotion credits-video project (source + node_modules for rendering)
COPY --from=builder /app/src/modules/stream-credits/credits-video ./credits-video

# Copy entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Create non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -m nodejs

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Set environment
ENV NODE_ENV=production

# Start the bot via entrypoint script
# This only runs prisma db push on fresh databases
ENTRYPOINT ["/app/docker-entrypoint.sh"]
