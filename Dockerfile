# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────
FROM node:20-alpine

# grep is available in alpine's busybox, but install GNU grep for better regex support
RUN apk add --no-cache grep

WORKDIR /app

# Copy dependencies and source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Data directory
RUN mkdir -p /data/clips

# Non-root user for security
RUN addgroup -S lanclip && adduser -S lanclip -G lanclip
RUN chown -R lanclip:lanclip /app /data
USER lanclip

EXPOSE 4040

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4040/health || exit 1

CMD ["node", "server.js"]
