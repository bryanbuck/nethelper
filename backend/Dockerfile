# NetHelper backend image.
#   docker build -t nethelper-backend ./backend
# Runtime tools the API shells out to: nmap + iproute2 (discovery), iputils-ping
# (ping monitor), git + openssh-client (config-backup Git mirror).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Prisma's engines need OpenSSL at generate time as well as at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY prisma ./prisma
RUN npx --no-install prisma generate

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tini openssl ca-certificates \
      nmap iproute2 iputils-ping \
      git openssh-client \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_FILES=false \
    BACKUP_STORAGE_PATH=/data/config-backups \
    BACKUP_GIT_REPO_PATH=/data/config-repo

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js docker-entrypoint.sh ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

# Runs as the image's unprivileged "node" user (uid 1000). /data holds config
# backups and the Git mirror; mount a volume there.
RUN mkdir -p /data/config-backups /data/config-repo \
 && chown -R node:node /data \
 && chmod 0755 docker-entrypoint.sh
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
