import { NextRequest, NextResponse } from "next/server";
import { olvidar, pedirAlPanel } from "@/lib/panel";
import { respuestaError, sinCache } from "@/lib/respuestas";

/**
 * Saca un ganador (panel: POST /api/sorteo/girar). Lo elige y lo guarda el
 * panel; acá solo se reenvía con la clave del operador.
 */
export async function POST(request: NextRequest) {
  const clave = request.headers.get("x-sorteo-clave");
  if (!clave) return NextResponse.json({ error: "Solo el operador del sorteo puede girar" }, { status: 401, headers: sinCache });
  try {
    const data = await pedirAlPanel("/api/sorteo/girar", request, { method: "POST", clave });
    olvidar("ganadores");
    return NextResponse.json({ success: true, data }, { headers: sinCache });
  } catch (e) {
    return respuestaError(e);
  }
}
