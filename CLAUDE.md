# CLAUDE.md

Landing pública del sorteo de clientes de Supricom Caracas (`sorteo.supricom.com.ve`). Next.js 16 (App Router) + TypeScript + Tailwind 4, `output: "standalone"`. Ver `README.md`.

- **Sin datos propios**: todo sale del panel (repo `Dashboard`, `app/api/sorteo/*`) vía `lib/panel.ts`. El navegador solo habla con las rutas `app/api/sorteo/*` de esta app, que reenvían al panel con caché corta (`conCache`: 60 s datos, 2 s ganadores) y sirven lo último si el panel cae (`desactualizado: true`).
- **El ganador lo elige el panel** (`POST /api/sorteo/girar`), nunca esta app. Girar/anular exigen `x-sorteo-clave` (la `SORTEO_CLAVE` del panel).
- Cada llamada al panel manda `x-sorteo-ip` (IP real, contada desde la derecha de `X-Forwarded-For`) firmada con `x-sorteo-proxy` = `SORTEO_PROXY_SECRET`, que tiene que ser igual en los dos servicios. Sin eso el panel cuenta a todos los visitantes como una IP y sus límites (60/min en datos, 8 claves fallidas/15 min) se vuelven un problema.
- `lib/tipos.ts` replica los tipos del panel y `components/` es copia de `components/sorteo/` del panel (solo modo público). Mantenerlos alineados.
- Comandos: `pnpm dev` (puerto 3001), `pnpm build`, `pnpm typecheck`. No hay tests ni ESLint.
