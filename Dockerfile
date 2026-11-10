# The app is a long-lived HTTP server: it holds SSE connections open for the
# live trace, ticks the scheduler every minute, and keeps agent turns running
# after the response that started them has been sent. That shape is why it is
# packaged as a container and not as serverless functions.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Production runs on Postgres, so no native build step is needed for anything.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Run as the image's own unprivileged user rather than root.
USER node
EXPOSE 4317
# No npm in the entrypoint: node is PID 1 and gets SIGTERM directly, so the
# host's shutdown signal is not swallowed by a wrapper process.
CMD ["node", "dist/src/app/server.js"]
