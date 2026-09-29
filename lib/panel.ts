import "server-only";

/**
 * Cliente del panel (Dashboard). Esta landing no tiene base de datos ni
 * credenciales de Odoo: clientes, tickets y ganadores salen de la API pública
 * del sorteo en el panel (app/api/sorteo/*), y el giro lo decide el panel.
 *
 * - Todo pasa por el servidor de la landing (el navegador solo habla con
 *   este dominio): no hace falta CORS y se puede cachear.
 * - Caché corta por endpoint: muchos espectadores no se convierten en muchas
 *   llamadas al panel (que además limita 60/min por IP en /api/sorteo).
 * - Si el panel no responde, se sirve lo último que se tenía, marcado como
 *   desactualizado. Girar sí necesita al panel.
 * - Cada llamada lleva la IP real del visitante firmada con
 *   SORTEO_PROXY_SECRET (el panel la usa para sus límites; ver
 *   lib/sorteo/operador.ts#ipVisitante en el panel).
 */

const PANEL = (process.env.PANEL_URL || "https://panel.supricom.com.ve").replace(/\/+$/, "");
const SECRETO = process.env.SORTEO_PROXY_SECRET || "";
const TIEMPO_MAX_MS = 20_000;

let avisado = false;
function avisarSinSecreto() {
  if (avisado || SECRETO.length >= 24) return;
  avisado = true;
  console.error("[sorteo] SORTEO_PROXY_SECRET falta o tiene menos de 24 caracteres: el panel va a contar a todos los visitantes como una sola IP.");
}

/**
 * IP real del visitante detrás del proxy de EasyPanel. Mismo criterio que
 * obtenerIp() del panel: se cuenta desde la derecha de X-Forwarded-For, porque
 * lo de la izquierda lo puede escribir el propio cliente.
 */
export function ipVisitante(request: Request): string {
  const saltos = Math.max(1, parseInt(process.env.PROXY_HOPS_CONFIABLES || "1", 10) || 1);
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const cadena = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (cadena.length) return cadena[Math.max(0, cadena.length - saltos)];
  }
  return request.headers.get("x-real-ip")?.trim() || "desconocida";
}

export class PanelError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Llama al panel y devuelve el `data` de su respuesta `{ success, data }`. */
export async function pedirAlPanel<T>(
  ruta: string,
  request: Request,
  opciones: { method?: "GET" | "POST"; body?: unknown; clave?: string | null } = {},
): Promise<T> {
  avisarSinSecreto();
  const headers: Record<string, string> = {
    "x-sorteo-ip": ipVisitante(request),
    ...(SECRETO ? { "x-sorteo-proxy": SECRETO } : {}),
    ...(opciones.clave ? { "x-sorteo-clave": opciones.clave } : {}),
    ...(opciones.body !== undefined ? { "Content-Type": "application/json" } : {}),
  };
  let r: Response;
  try {
    r = await fetch(`${PANEL}${ruta}`, {
      method: opciones.method || "GET",
      headers,
      body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIEMPO_MAX_MS),
    });
  } catch (e: any) {
    console.error(`[sorteo] el panel no respondió ${ruta}:`, e?.message);
    throw new PanelError(503, "El panel no responde");
  }
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j?.success) {
    throw new PanelError(r.status >= 400 ? r.status : 502, j?.error || `El panel respondió ${r.status}`);
  }
  return j.data as T;
}

/**
 * Caché de la última respuesta buena por llave. Comparte la lectura en vuelo
 * entre quienes llegan a la vez y, si el panel falla, devuelve la última buena
 * con `desactualizado: true`.
 */
const cache = new Map<string, { valor: unknown; vence: number }>();
const enVuelo = new Map<string, Promise<unknown>>();

export async function conCache<T>(
  llave: string,
  ttlMs: number,
  leer: () => Promise<T>,
  forzar = false,
): Promise<{ valor: T; desactualizado: boolean }> {
  const x = cache.get(llave);
  if (!forzar && x && x.vence > Date.now()) return { valor: x.valor as T, desactualizado: false };

  let p = enVuelo.get(llave) as Promise<T> | undefined;
  if (!p || forzar) {
    p = leer();
    enVuelo.set(llave, p);
    p.then(
      (valor) => cache.set(llave, { valor, vence: Date.now() + ttlMs }),
      () => undefined,
    ).finally(() => { if (enVuelo.get(llave) === p) enVuelo.delete(llave); });
  }
  try {
    return { valor: await p, desactualizado: false };
  } catch (e) {
    // Un 401/403/429 del panel no es "el panel se cayó": no se tapa con lo viejo.
    if (x && (!(e instanceof PanelError) || e.status >= 500)) return { valor: x.valor as T, desactualizado: true };
    throw e;
  }
}

export function olvidar(llave: string) {
  cache.delete(llave);
}
