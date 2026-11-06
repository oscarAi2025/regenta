import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { csv } from "@/lib/reportes";
import { fechaReal } from "@/lib/validar";

const TIPO: Record<string, string> = { inicial: "Inicial", compra: "Compra", venta: "Venta", devolucion: "Devolución", anulacion: "Anulación", ajuste: "Ajuste" };
const fecha = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && fechaReal(v) ? v : null);

/** Kardex de un producto: movimientos con saldo acumulado (JSON, o CSV con ?formato=csv). Dueño, administrador o bodega. */
export const GET = conSesion(async (s, req) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "El kardex lo ven el dueño, el administrador o la bodega" }, 403);
  const sp = new URL(req.url).searchParams;
  const producto = sp.get("producto") ?? "", lote = sp.get("lote") || null;
  if (!esUuid(producto) || (lote && !esUuid(lote))) return json({ error: "Producto o lote no válido" }, 400);
  const desde = fecha(sp.get("desde")), hasta = fecha(sp.get("hasta"));
  const d = await comoUsuario(s, async (c) => {
    const p = (await c.query(`select nombre, unidades_por_caja from productos where id = $1 and empresa_id = $2`, [producto, s.empresa])).rows[0];
    if (!p) return null;
    const filas = (await c.query(`select id::text, to_char(fecha at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, tipo, documento, lote, vence::text, usuario, entrada, salida, saldo
      from kardex($1, $2::date, $3::date, $4::uuid)`, [producto, desde, hasta, lote])).rows;
    return { p, filas };
  });
  if (!d) return json({ error: "Ese producto no existe en tu droguería" }, 404);
  if (sp.get("formato") === "csv") {
    const filas = d.filas.map((f) => ({ ...f, tipo: TIPO[f.tipo] ?? f.tipo, usuario: String(f.usuario ?? "").split(" (")[0] }));
    const nombre = d.p.nombre.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "producto";
    return new Response(csv(filas, [["fecha", "Fecha"], ["tipo", "Tipo"], ["documento", "Documento o motivo"], ["lote", "Lote"], ["vence", "Vence"], ["usuario", "Usuario"], ["entrada", "Entrada (und)"], ["salida", "Salida (und)"], ["saldo", "Saldo (und)"]]), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kardex-${nombre}${desde ? `-${desde}` : ""}${hasta ? `-a-${hasta}` : ""}.csv"`, "cache-control": "no-store" } });
  }
  return json({ producto: d.p.nombre, unidades_por_caja: d.p.unidades_por_caja, movimientos: d.filas });
});
