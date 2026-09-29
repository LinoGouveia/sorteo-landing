import { NextResponse } from "next/server";
import { PanelError } from "./panel";

export function respuestaError(e: unknown) {
  const status = e instanceof PanelError ? e.status : 500;
  const error = e instanceof PanelError ? e.message : "Error interno";
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export const sinCache = { "Cache-Control": "no-store" };
