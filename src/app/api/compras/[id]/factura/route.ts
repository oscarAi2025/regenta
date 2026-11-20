import { createHash } from "node:crypto";
import { comoUsuario, sinRLS, type Tx } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puedeCompras } from "@/lib/compras";
import { MAX_ARCHIVO, seVeEnPantalla, tipoArchivo, type ArchivoCompra } from "@/lib/compra-archivo";

// La factura original del proveedor de una compra ya registrada:
//  · GET ?archivo=<id> la muestra (PDF o foto en el navegador; ZIP/XML, o con &descargar=1, como descarga).
//  · POST (formulario con «archivo») la adjunta a la compra, para las que se registraron a mano sin subirla.
// Leerla: dueño y administrador (la política de compra_archivos). Adjuntarla: también la bodega, que es quien recibe.

const ext: Record<string, string> = { "application/zip": "zip", "application/xml": "xml", "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function listar(c: Tx, empresa: string, compra: string): Promise<ArchivoCompra[]> {
  return (await c.query(`select a.id, a.nombre, a.tipo, a.tamano, to_char(a.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') creado, mi.nombre usuario
    from compra_archivos a left join miembros mi on mi.empresa_id = a.empresa_id and mi.user_id = a.usuario_id
    where a.compra_id = $1 and a.empresa_id = $2 order by a.creado`, [compra, empresa])).rows;
}

export const GET = conSesion(async (s, req, ctx) => {
  if (!puedeCompras.dinero(s.rol)) return json({ error: "La factura del proveedor la ven el dueño o el administrador" }, 403);
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const archivo = sp.get("archivo") ?? "";
  if (!esUuid(id) || !esUuid(archivo)) return json({ error: "Archivo no válido" }, 400);
  const a = await comoUsuario(s, async (c) => (await c.query(`select nombre, tipo, datos from compra_archivos where id = $1 and compra_id = $2 and empresa_id = $3`,
    [archivo, id, s.empresa])).rows[0] as { nombre: string; tipo: string; datos: Buffer } | undefined);
  if (!a) return json({ error: "Esa factura no está en esta compra" }, 404);
  const nombre = (a.nombre.replace(/[^\w.\- ]+/g, "_").replace(/\.[a-z0-9]{2,4}$/i, "") || "factura") + "." + (ext[a.tipo] ?? "bin");
  const verAqui = seVeEnPantalla(a.tipo) && sp.get("descargar") !== "1";
  return new Response(new Uint8Array(a.datos), {
    headers: {
      "content-type": a.tipo, "content-length": String(a.datos.length), "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      "content-disposition": `${verAqui ? "inline" : "attachment"}; filename="${nombre}"`,
    },
  });
});

export const POST = conSesion(async (s, req, ctx) => {
  if (!puedeCompras.ver(s.rol)) return json({ error: "La factura la adjuntan el dueño, el administrador o la bodega" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Compra no válida" }, 400);
  const form = await req.formData().catch(() => null);
  const f = form?.get("archivo");
  if (!(f instanceof File) || !f.size) return json({ error: "Elige el archivo de la factura" }, 400);
  if (f.size > MAX_ARCHIVO) return json({ error: "El archivo pesa más de 12 MB. Si es una foto, tómala de nuevo o súbela más liviana" }, 413);
  const datos = new Uint8Array(await f.arrayBuffer());
  const tipo = tipoArchivo(datos);
  if (!tipo) return json({ error: "Sube el PDF, una foto (JPG o PNG) o el ZIP/XML de la factura electrónica" }, 415);
  const sha = createHash("sha256").update(datos).digest("hex");
  const r = await comoUsuario(s, async (c) => {
    const k = (await c.query(`select estado from compras where id = $1 and empresa_id = $2`, [id, s.empresa])).rows[0] as { estado: string } | undefined;
    if (!k) return { error: "Esa compra no existe en tu droguería", status: 404 };
    if (k.estado === "anulada") return { error: "La compra está anulada: no se le adjuntan archivos", status: 409 };
    const g = (await c.query(`select guardar_archivo_compra($1, $2, $3, $4, $5, null) r`, [s.empresa, f.name.slice(0, 160), tipo, Buffer.from(datos), sha])).rows[0].r as
      { id: string | null; compra_id: string | null; compra_numero: number | null; demo?: boolean };
    if (g.demo || !g.id) return { error: "En la demostración no se guardan archivos", status: 409 };
    if (g.compra_id && g.compra_id !== id) return { error: `Ese archivo ya está adjunto a la compra N.º ${g.compra_numero ?? "anulada"}`, status: 409 };
    await c.query(`select vincular_archivo_compra($1, $2, $3)`, [s.empresa, g.id, id]);
    return { ok: true, archivo: g.id, archivos: puedeCompras.dinero(s.rol) ? await listar(c, s.empresa, id) : [] };
  });
  if (!("error" in r)) await sinRLS((c) => c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'adjuntar_factura', 'compras', $3, $4)`,
    [s.empresa, s.uid, id, JSON.stringify({ archivo: r.archivo, nombre: f.name.slice(0, 160), tipo })]));
  return "error" in r ? json({ error: r.error }, r.status) : json({ ok: true, archivos: r.archivos, mensaje: "Factura adjunta a la compra" }, 201);
});
