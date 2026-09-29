# sorteo-landing

Landing pública de los sorteos de clientes de **Supricom** (`sorteo.supricom.com.ve`).
El sorteo activo (sede Valencia / Caracas / Panamá, mes de las compras, monto por ticket y título) se configura en el
panel, en **SuperAdmin › Ventas › Sorteo de clientes**, y esta página lo toma sola: cada *monto por ticket* en compras
del mes es **1 ticket**.

Es una aplicación aparte del panel (repo `Dashboard`), pero **no tiene base de datos ni credenciales**:
clientes, tickets y ganadores salen de la API pública del sorteo en el panel, y el ganador lo elige el panel.

```
Navegador ──► sorteo-landing (/api/sorteo/*) ──► panel (/api/sorteo/*) ──► Odoo / MySQL
               caché corta + últimos datos            elige y guarda el ganador
```

## Qué hace

- **Ruleta anónima**: los segmentos (proporcionales a los tickets) dicen «? ? ?». La API pública del panel ni siquiera
  trae los nombres (solo id y tickets); el nombre se conoce cuando gana, en el cartel y la lista de **ganadores**.
- **Girar**: solo el operador, con la clave `SORTEO_CLAVE` del panel (botón «Operador» al pie). También se puede
  girar desde el panel: todas las pantallas sondean los ganadores cada 5 s y giran hasta el nuevo.
- **Grabar giro** (operador): al tocar GIRAR la ruleta se agranda, el fondo se difumina y se graba un video
  cuadrado de 1080×1080 del giro hasta el ganador, con sonido, cartel y confeti (`lib/grabacion.ts`). Se descarga
  solo al terminar (MP4 en Chrome/Edge/Safari; WebM donde no haya MP4).
- **Cambio de sorteo**: si en el panel cambian la sede, el mes o el monto, las pantallas abiertas se actualizan solas.
- **Si el panel no responde**: se muestran los últimos datos, con aviso, y no se puede girar.

## Variables de entorno (ejecución)

| Variable | Qué es |
|---|---|
| `PANEL_URL` | URL del panel, sin barra final. Default `https://panel.supricom.com.ve`. |
| `SORTEO_PROXY_SECRET` | **El mismo valor** que `SORTEO_PROXY_SECRET` en el panel (≥ 24 caracteres). Firma la IP real del visitante (`x-sorteo-ip`) para que los límites del panel cuenten por visitante y no por la IP de este servidor. Sin él, 8 claves fallidas de cualquiera bloquean al operador 15 minutos. |
| `PROXY_HOPS_CONFIABLES` | Proxies propios delante de este servicio. EasyPanel (Traefik) = `1` (default). |

Ninguna es de build: no pasarlas como `--build-arg`.

## Desarrollo

```bash
pnpm install
pnpm dev          # http://localhost:3001
pnpm typecheck
```

Con `PANEL_URL=http://localhost:3000` apunta a un panel local.

## Despliegue (EasyPanel)

Servicio nuevo desde este repo con el `Dockerfile` (Next.js standalone, puerto 3000), dominio
`sorteo.supricom.com.ve` con HTTPS y las variables de arriba.

## Si cambia la API del panel

Los tipos están en `lib/tipos.ts` y replican los de `lib/sorteo/*` del panel. `components/RuletaSorteo.tsx` es una copia
del de `components/sorteo/` del panel con lo de la grabación agregado (rotación, segmentos y audio expuestos): si se
corrige algo de la ruleta allá, traerlo acá. `lib/grabacion.ts` redibuja la misma geometría en canvas: si cambia la
ruleta, cambiarla también ahí.
