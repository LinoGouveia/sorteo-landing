# Landing del sorteo (sorteo.supricom.com.ve). Next.js en modo standalone:
# la imagen final solo lleva el servidor compilado, sin node_modules completos.

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm
# pnpm-workspace.yaml trae los permisos de build (sharp, @tailwindcss/oxide):
# sin él, pnpm 10+ aborta con ERR_PNPM_IGNORED_BUILDS.
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Sin variables de build: PANEL_URL y SORTEO_PROXY_SECRET se leen en
# ejecución (EasyPanel las inyecta en el contenedor). No pasar secretos como
# --build-arg: quedan en el log del despliegue.
RUN pnpm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
