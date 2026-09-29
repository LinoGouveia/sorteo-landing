import { NextRequest, NextResponse } from "next/server";
import { pedirAlPanel } from "@/lib/panel";
import { respuestaError, sinCache } from "@/lib/respuestas";

/** Verifica la clave de operador contra el panel (POST /api/sorteo/operador). */
export async function POST(request: NextRequest) {
  const clave = request.headers.get("x-sorteo-clave");
  if (!clave) return NextResponse.json({ error: "Falta la clave de operador" }, { status: 401, headers: sinCache });
  try {
    const data = await pedirAlPanel("/api/sorteo/operador", request, { method: "POST", clave });
    return NextResponse.json({ success: true, data }, { headers: sinCache });
  } catch (e) {
    return respuestaError(e);
  }
}
