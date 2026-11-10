# NetHelper frontend image: the built SPA served by unprivileged nginx, which
# also proxies /api and /socket.io to the backend (same origin, no CORS).
#   docker build -t nethelper-frontend ./frontend
# BACKEND_UPSTREAM (host:port) picks the backend at container start.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_APP_VERSION=0.9.0
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30-alpine
ENV BACKEND_UPSTREAM=backend:3000
COPY nginx/security-headers.conf /etc/nginx/snippets/nethelper-security-headers.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
