# Stage 1 — Install dependencies
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 2 — Production image
FROM node:18-alpine AS production
WORKDIR /app

# Security best practice — run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only what we need
COPY --from=builder /app/node_modules ./node_modules
COPY app/ ./app/
COPY package.json ./

# Set ownership
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "app/index.js"]
