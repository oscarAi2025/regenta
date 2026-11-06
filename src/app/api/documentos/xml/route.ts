import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { leerFiltro, xmlDocumentos } from "@/lib/documentos";
import { puedeDian } from "@/lib/dian/soporte";
import { zip } from "@/lib/zip";

/** ZIP con los XML de los documentos del filtro (mismos filtros de la pantalla). Solo dueño y administrador. */
export const GET = conSesion(async (s, req) => {
  if (!puedeDian.emitir(s.rol)) return json({ error: "Los documentos electrónicos son del dueño o el administrador" }, 403);
  const f = leerFiltro(Object.fromEntries(new URL(req.url).searchParams));
  const docs = await comoUsuario(s, (c) => xmlDocumentos(c, s.empresa, f));
  if (!docs.length) return json({ error: "No hay XML de documentos en estas fechas y filtros" }, 404);
  const usados = new Set<string>();
  const archivos = docs.map((d) => {
    let nombre = `${d.tipo}/${String(d.numero).replace(/[^A-Za-z0-9_-]/g, "")}.xml`;
    for (let i = 2; usados.has(nombre); i++) nombre = `${d.tipo}/${String(d.numero).replace(/[^A-Za-z0-9_-]/g, "")}-${i}.xml`;
    usados.add(nombre);
    return { nombre, datos: d.xml };
  });
  return new Response(new Uint8Array(zip(archivos)), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="regenta-xml-${f.desde}-a-${f.hasta}.zip"`, "cache-control": "no-store" } });
});
