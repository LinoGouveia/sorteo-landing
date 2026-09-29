# CLAUDE.md

Landing pública de los sorteos de clientes de Supricom (`sorteo.supricom.com.ve`). El sorteo activo (sede, mes, monto por ticket, título) se configura en el panel y llega en `/api/sorteo` → `sorteo`. Next.js 16 (App Router) + TypeScript + Tailwind 4, `output: "standalone"`. Ver `README.md`.

- **Sin datos propios**: todo sale del panel (repo `Dashboard`, `app/api/sorteo/*`) vía `lib/panel.ts`. El navegador solo habla con las rutas `app/api/sorteo/*` de esta app, que reenvían al panel con caché corta (`conCache`: 60 s datos, 2 s ganadores) y sirven lo último si el panel cae (`desactualizado: true`).
- **El ganador lo elige el panel** (`POST /api/sorteo/girar`), nunca esta app. Girar/anular exigen `x-sorteo-clave` (la `SORTEO_CLAVE` del panel).
- Cada llamada al panel manda `x-sorteo-ip` (IP real, contada desde la derecha de `X-Forwarded-For`) firmada con `x-sorteo-proxy` = `SORTEO_PROXY_SECRET`, que tiene que ser igual en los dos servicios. Sin eso el panel cuenta a todos los visitantes como una IP y sus límites (60/min en datos, 8 claves fallidas/15 min) se vuelven un problema.
- La ruleta es **anónima** («? ? ?»): la API pública solo trae `{ id, tickets }` por participante; no mostrar ni pedir nombres de participantes. No hay tabla de participantes en la landing (está en el panel).
- «Grabar giro» (`lib/grabacion.ts`): no graba la pantalla; redibuja la ruleta en un canvas 1080×1080 con la rotación de `RuletaHandle.rotacion()` y lo graba con MediaRecorder. Si cambia la geometría de `components/RuletaSorteo.tsx`, cambiarla también ahí.
- Las etiquetas se enderezan cuadro a cuadro tocando el DOM (`orientar()`), no con estado de React: un re-render por cuadro sería caro.
- `lib/tipos.ts` replica los tipos del panel y `components/RuletaSorteo.tsx` es copia de la del panel (más lo de grabar). Mantenerlos alineados.
- Comandos: `pnpm dev` (puerto 3001), `pnpm build`, `pnpm typecheck`. No hay tests ni ESLint.
