import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { leerSesionConsulta } from "@/lib/sesion";
import { leerFiltro, xmlDocumentos } from "@/lib/documentos";
import { limiteBD } from "@/lib/api";
import { zip } from "@/lib/zip";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/** Modo consulta: ZIP con los XML de las facturas electrónicas y notas del rango. La droguería debe conservarlos (y
 *  responder a la DIAN) aunque su plan haya vencido, así que la suspensión no se los quita. Dueño o administrador. */
export async function GET(req: Request) {
  const s = await leerSesionConsulta();
  if (!s) return NextResponse.json({ error: "Tu sesión venció: vuelve a entrar" }, { status: 401 });
  if (!(await limiteBD(`consulta-xml:${s.empresa}`, 30, "1 hour"))) return NextResponse.json({ error: "Ya descargaste varios paquetes: espera un rato" }, { status: 429 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const f = leerFiltro({ desde: sp.desde, hasta: sp.hasta });
  const docs = await sinRLS((c) => xmlDocumentos(c, s.empresa, f));   // la consulta filtra por la droguería de la sesión
  if (!docs.length) return NextResponse.json({ error: "No hay XML de documentos en esas fechas" }, { status: 404 });
  const usados = new Set<string>();
  const archivos = docs.map((d) => {
    let nombre = `${d.tipo}/${String(d.numero).replace(/[^A-Za-z0-9_-]/g, "")}.xml`;
    for (let i = 2; usados.has(nombre); i++) nombre = `${d.tipo}/${String(d.numero).replace(/[^A-Za-z0-9_-]/g, "")}-${i}.xml`;
    usados.add(nombre);
    return { nombre, datos: d.xml };
  });
  return new Response(new Uint8Array(zip(archivos)), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="regenta-xml-${f.desde}-a-${f.hasta}.zip"`, "cache-control": "no-store" } });
}
