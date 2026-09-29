import { NextRequest, NextResponse } from "next/server";
import { conCache, pedirAlPanel } from "@/lib/panel";
import { respuestaError, sinCache } from "@/lib/respuestas";
import type { Ganador } from "@/lib/tipos";

export const dynamic = "force-dynamic";

type Ganadores = { ganadores: Ganador[]; ganadoresError: string | null };

/**
 * Ganadores oficiales (panel: GET /api/sorteo/ganadores). Cada pantalla lo
 * consulta cada 5 s; con la caché de 2 s el panel recibe a lo sumo una
 * llamada cada 2 s, haya los espectadores que haya.
 */
export async function GET(request: NextRequest) {
  try {
    const { valor, desactualizado } = await conCache("ganadores", 2_000, () => pedirAlPanel<Ganadores>("/api/sorteo/ganadores", request));
    return NextResponse.json({ success: true, data: { ...valor, desactualizado } }, { headers: sinCache });
  } catch (e) {
    return respuestaError(e);
  }
}
