import { NextRequest, NextResponse } from "next/server";
import { olvidar, pedirAlPanel } from "@/lib/panel";
import { respuestaError, sinCache } from "@/lib/respuestas";

/** Anula un premio `{ id }` o todos `{ todos: true }` (panel: POST /api/sorteo/anular). */
export async function POST(request: NextRequest) {
  const clave = request.headers.get("x-sorteo-clave");
  if (!clave) return NextResponse.json({ error: "Solo el operador del sorteo puede anular" }, { status: 401, headers: sinCache });
  const body = await request.json().catch(() => ({}));
  const cuerpo = body?.todos === true ? { todos: true } : { id: Number(body?.id) };
  try {
    await pedirAlPanel("/api/sorteo/anular", request, { method: "POST", clave, body: cuerpo });
    olvidar("ganadores");
    return NextResponse.json({ success: true }, { headers: sinCache });
  } catch (e) {
    return respuestaError(e);
  }
}
