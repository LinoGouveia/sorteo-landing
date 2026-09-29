import { NextRequest, NextResponse } from "next/server";
import { conCache, pedirAlPanel } from "@/lib/panel";
import { respuestaError, sinCache } from "@/lib/respuestas";
import type { RespuestaSorteo } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/**
 * Clientes, tickets y ganadores del sorteo (panel: GET /api/sorteo).
 * Caché de 60 s: el panel cachea Odoo 5 min, así que más seguido no trae
 * nada nuevo. ?refrescar=1 (solo el operador, con su clave) relee Odoo.
 */
export async function GET(request: NextRequest) {
  const refrescar = request.nextUrl.searchParams.get("refrescar") === "1";
  const clave = request.headers.get("x-sorteo-clave");
  try {
    if (refrescar) {
      const data = await pedirAlPanel<RespuestaSorteo>("/api/sorteo?refrescar=1", request, { clave });
      await conCache("sorteo", 60_000, async () => data, true);
      return NextResponse.json({ success: true, data }, { headers: sinCache });
    }
    const { valor, desactualizado } = await conCache("sorteo", 60_000, () => pedirAlPanel<RespuestaSorteo>("/api/sorteo", request));
    return NextResponse.json({ success: true, data: { ...valor, desactualizado } }, { headers: sinCache });
  } catch (e) {
    return respuestaError(e);
  }
}
