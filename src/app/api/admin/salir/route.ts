import { NextResponse } from "next/server";
import { mismoOrigen } from "@/lib/api";
import { cerrarSesionAdmin } from "@/lib/admin";

export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  await cerrarSesionAdmin();
  return NextResponse.json({ ok: true });
}
