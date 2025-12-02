FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY tsconfig.json .
COPY src ./src
RUN npm run build

FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
RUN mkdir -p data uploads
EXPOSE 5000
CMD ["node","dist/server.js"]
