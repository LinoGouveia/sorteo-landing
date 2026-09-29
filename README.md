# sorteo-landing

Landing pública del **Gran Sorteo Supricom · Caracas** (`sorteo.supricom.com.ve`).
Ruleta con los clientes de la sucursal Caracas: cada **$5.000** en compras del mes es **1 ticket**.

Es una aplicación aparte del panel (repo `Dashboard`), pero **no tiene base de datos ni credenciales**:
clientes, tickets y ganadores salen de la API pública del sorteo en el panel, y el ganador lo elige el panel.

```
Navegador ──► sorteo-landing (/api/sorteo/*) ──► panel (/api/sorteo/*) ──► Odoo / MySQL
               caché corta + últimos datos            elige y guarda el ganador
```

## Qué hace

- **Ruleta** (segmentos proporcionales a los tickets), **ganadores** y **participantes** (nombre, compras, monto,
  tickets, probabilidad; export a Excel). Sin RIF ni facturas: el panel no los expone por la API pública.
- **Girar**: solo el operador, con la clave `SORTEO_CLAVE` del panel (botón «Operador» al pie). También se puede
  girar desde el panel (SuperAdmin › Ventas › Sorteo Caracas): todas las pantallas sondean los ganadores cada 5 s
  y giran hasta el nuevo.
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

Los tipos están en `lib/tipos.ts` y replican los de `lib/sorteo/*` del panel. Los componentes (`components/`) son una
copia de `components/sorteo/` del panel, adaptada a solo-público: si se corrige algo de la ruleta allá, traerlo acá.
