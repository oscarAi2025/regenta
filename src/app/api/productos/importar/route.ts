import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";

// Carga masiva de productos (y existencias iniciales) desde una hoja de cálculo exportada a CSV.
// Primero se llama con simular=true: valida todo y dice qué va a pasar fila por fila. Si no hay errores, se llama
// con simular=false y se aplica TODO en una sola transacción (o nada).
const Fila = z.object({
  nombre: z.string().trim().min(3).max(200),
  codigo_barras: z.string().trim().regex(/^\d{8,14}$/).or(z.literal("")).default(""),
  laboratorio: z.string().trim().max(120).default(""),
  iva: z.coerce.number().refine((n) => [0, 5, 19].includes(n), "El IVA debe ser 0, 5 o 19"),
  unidades_por_caja: z.coerce.number().int().min(1).max(1000).default(1),
  precio_caja: z.coerce.number().positive("Falta el precio de venta"),
  precio_unidad: z.coerce.number().positive().optional(),
  stock_minimo: z.coerce.number().int().min(0).default(0),
  lote: z.string().trim().max(40).default(""),
  vence: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de vencimiento va como AAAA-MM-DD").or(z.literal("")).default(""),
  cantidad_unidades: z.coerce.number().int().min(0).default(0),
  costo_unidad: z.coerce.number().min(0).optional(),
  registro_sanitario: z.string().trim().max(60).default(""),
});
const Peticion = z.object({ simular: z.boolean(), filas: z.array(z.record(z.string(), z.unknown())).min(1).max(5000) });

const MENSAJES: Record<string, string> = { nombre: "nombre", codigo_barras: "código de barras (8 a 14 dígitos)", precio_caja: "precio de venta", iva: "IVA", unidades_por_caja: "unidades por caja", vence: "vence" };

export const POST = conSesion(async (s, req) => {
  if (s.rol !== "dueno" && s.rol !== "admin") return json({ error: "Solo el dueño o el administrador pueden cargar productos" }, 403);
  const p = Peticion.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "El archivo no tiene filas válidas" }, 400);
  const errores: { fila: number; error: string }[] = [];
  const filas: (z.infer<typeof Fila> & { n: number })[] = [];
  p.data.filas.forEach((f, i) => {
    const vacio = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
    const r = Fila.safeParse({ ...f, precio_unidad: vacio(f.precio_unidad), costo_unidad: vacio(f.costo_unidad), unidades_por_caja: vacio(f.unidades_por_caja), stock_minimo: vacio(f.stock_minimo), cantidad_unidades: vacio(f.cantidad_unidades), iva: vacio(f.iva) ?? 0 });
    if (!r.success) { const is = r.error.issues[0]; errores.push({ fila: i + 2, error: `${MENSAJES[String(is.path[0])] ?? String(is.path[0])}: ${is.message}` }); return; }
    if (r.data.cantidad_unidades > 0 && !r.data.lote) { errores.push({ fila: i + 2, error: "Si pones cantidad, pon también el lote" }); return; }
    filas.push({ ...r.data, n: i + 2 });
  });
  const vistos = new Map<string, number>();
  for (const f of filas) if (f.codigo_barras) {
    if (vistos.has(f.codigo_barras)) errores.push({ fila: f.n, error: `Código de barras repetido (también en la fila ${vistos.get(f.codigo_barras)})` });
    else vistos.set(f.codigo_barras, f.n);
  }

  const resultado = await comoUsuario(s, async (c) => {
    const eans = filas.map((f) => f.codigo_barras).filter(Boolean);
    const existentes = new Map<string, string>((await c.query(`select ean, id from productos where empresa_id = $1 and activo and ean = any($2)`, [s.empresa, eans])).rows.map((r) => [r.ean, r.id]));
    const maestro = new Map<string, string>((await c.query(`select ean, id from productos_maestro where ean = any($1)`, [eans])).rows.map((r) => [r.ean, r.id]));
    const plan = filas.map((f) => ({ fila: f.n, nombre: f.nombre, accion: f.codigo_barras && existentes.has(f.codigo_barras) ? "actualizar" : "crear", existencias: f.cantidad_unidades }));
    if (p.data.simular || errores.length) return { plan };

    const lineas: { producto_id: string; lote: string; vence: string | null; unidades: number; costo_unidad?: number }[] = [];
    for (const f of filas) {
      const pu = f.unidades_por_caja > 1 ? f.precio_unidad ?? null : null;
      let id = f.codigo_barras ? existentes.get(f.codigo_barras) : undefined;
      if (id) {
        await c.query(`update productos set nombre = $2, laboratorio = nullif($3, ''), iva = $4, unidades_por_caja = $5, precio_caja = $6, precio_unidad = $7, stock_minimo = $8, registro_sanitario = coalesce(nullif(upper($9), ''), registro_sanitario) where id = $1`,
          [id, f.nombre, f.laboratorio, f.iva, f.unidades_por_caja, f.precio_caja, pu, f.stock_minimo, f.registro_sanitario]);
      } else {
        id = (await c.query(`insert into productos (empresa_id, maestro_id, nombre, laboratorio, ean, iva, unidades_por_caja, precio_caja, precio_unidad, stock_minimo, registro_sanitario)
          values ($1, $2, $3, nullif($4, ''), nullif($5, ''), $6, $7, $8, $9, $10, nullif(upper($11), '')) returning id`,
          [s.empresa, f.codigo_barras ? maestro.get(f.codigo_barras) ?? null : null, f.nombre, f.laboratorio, f.codigo_barras, f.iva, f.unidades_por_caja, f.precio_caja, pu, f.stock_minimo, f.registro_sanitario])).rows[0].id;
      }
      if (f.cantidad_unidades > 0) lineas.push({ producto_id: id!, lote: f.lote, vence: f.vence || null, unidades: f.cantidad_unidades, ...(f.costo_unidad !== undefined ? { costo_unidad: f.costo_unidad } : {}) });
    }
    if (lineas.length) {
      const sede = (await c.query(`select id from sedes where empresa_id = $1 order by creado limit 1`, [s.empresa])).rows[0];
      await c.query(`select registrar_entrada($1)`, [{ empresa_id: s.empresa, sede_id: sede.id, tipo: "inicial", lineas }]);
    }
    return { plan, aplicado: true };
  });
  return json({ ...resultado, errores, filas_validas: filas.length });
});
