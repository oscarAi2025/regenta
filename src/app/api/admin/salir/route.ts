import { NextResponse } from "next/server";
import { mismoOrigen } from "@/lib/api";
import { cerrarSesionAdmin } from "@/lib/admin";
import { cerrarSesion, leerSesion } from "@/lib/sesion";

export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if ((await leerSesion())?.soporte) await cerrarSesion(); // la sesión de soporte no sobrevive a la consola
  await cerrarSesionAdmin();
  return NextResponse.json({ ok: true });
}
