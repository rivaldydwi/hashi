# syntax=docker/dockerfile:1
# Hashi — multi-stage build
#   tools  : untuk migrate, seed, dan test RLS (punya devDependencies)
#   runner : aplikasi Next.js production (standalone, kecil)

FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS tools
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
# HANYA src/db (bukan seluruh src). Script di scripts/ tidak boleh mengimpor dari luar src/db;
# CI menjalankan test:rls dari image ini untuk memastikannya.
COPY src/db ./src/db
# Folder dokumen untuk seed demo (volume docs-data dipasang di sini oleh compose). Dibuat dan di-chown SEBELUM `USER node`,
# supaya volume baru yang kosong mewarisi pemilik node dan seed bisa menulis berkas dummy.
ENV STORAGE_DIR=/app/docs-data
RUN mkdir -p /app/docs-data && chown node:node /app/docs-data
USER node
CMD ["npm", "run", "db:migrate"]

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3100 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
# Font Noto Sans JP (OFL) untuk ekspor PDF Catatan kegiatan: dibaca dari ./assets/fonts (process.cwd() = /app)
COPY --from=builder --chown=node:node /app/assets ./assets
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# Folder dokumen (volume docs-data dipasang di sini). Dibuat dan di-chown SEBELUM `USER node`,
# supaya volume baru yang kosong mewarisi pemilik node dan aplikasi bisa menulis.
ENV STORAGE_DIR=/app/docs-data
RUN mkdir -p /app/docs-data && chown node:node /app/docs-data
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/api/health || exit 1
CMD ["node", "server.js"]
