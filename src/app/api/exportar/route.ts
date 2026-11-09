import { NextResponse } from "next/server";
import { leerSesion } from "@/lib/sesion";
import { exportarEmpresa } from "@/lib/exportar";
import { demoProtegida, limiteBD } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/** Copia completa de los datos de la droguería (ZIP con CSV). Solo el dueño; unas pocas por hora. */
export async function GET() {
  const s = await leerSesion();
  if (!s) return NextResponse.json({ error: "Tu sesión venció: vuelve a entrar" }, { status: 401 });
  if (s.rol !== "dueno") return NextResponse.json({ error: "Solo el dueño descarga la copia de los datos" }, { status: 403 });
  if (await demoProtegida(s.empresa)) return NextResponse.json({ error: "En la demostración no se descarga la copia de los datos: tiene datos de prueba de otros visitantes." }, { status: 403 });
  if (!(await limiteBD(`exportar:${s.empresa}`, 6, "1 hour"))) return NextResponse.json({ error: "Ya descargaste varias copias: espera un rato" }, { status: 429 });
  const r = await exportarEmpresa(s.empresa);
  if (!r) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return new Response(new Uint8Array(r.datos), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${r.nombre}"`, "cache-control": "no-store" } });
}
