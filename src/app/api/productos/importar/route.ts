import { randomUUID } from "node:crypto";
import { z } from "zod";
import { comoUsuario, puestoDeTrabajo, sinRLS } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { CAMPOS, claveNombre, leerFilas, type Campo, type Nota, type Producto } from "@/lib/importar";

export const maxDuration = 26;

// Carga masiva de productos y existencias desde el archivo que exporta cualquier sistema (Excel o CSV, leído en el
// navegador). Primero simular=true: dice fila por fila qué va a pasar. Luego simular=false aplica TODO en una sola
// transacción (o nada). Nunca duplica:
//   · el mismo producto en varias filas se crea una vez (por código de barras, o por nombre + laboratorio);
//   · un producto que ya existe en la droguería se actualiza (solo las columnas que trae el archivo);
//   · un lote que ya está cargado no se vuelve a sumar (subir el mismo archivo dos veces no cambia el inventario).
const Peticion = z.object({
  simular: z.boolean(),
  idem_key: z.string().max(80).nullish(),
  filas: z.array(z.record(z.string(), z.unknown())).min(1).max(15000),
  primera_fila: z.number().int().min(1).max(1000).optional(),
});

type Existente = { id: string; nombre: string; laboratorio: string | null; ean: string | null; activo: boolean; maestro_id: string | null };

export const POST = conSesion(async (s, req) => {
  if (s.rol !== "dueno" && s.rol !== "admin") return json({ error: "Solo el dueño o el administrador pueden cargar productos" }, 403);
  const p = Peticion.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.path[0] === "filas" && p.error.issues[0]?.code === "too_big" ? "El archivo tiene más de 15.000 filas: divídelo en dos" : "El archivo no tiene filas válidas" }, 400);
  const filas = p.data.filas.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => (CAMPOS as readonly string[]).includes(k))));
  if (!filas.some((f) => "nombre" in f)) return json({ error: "Falta la columna del nombre del producto" }, 400);
  if (!filas.some((f) => "precio_caja" in f || "precio_unidad" in f)) return json({ error: "Falta la columna del precio de venta" }, 400);

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const lec = leerFilas(filas, hoy, p.data.primera_fila ?? 2);
  const avisos: Nota[] = [...lec.avisos];

  const resultado = await comoUsuario(s, async (c) => {
    const sede = (await puestoDeTrabajo(c, s.empresa)).sede_id;
    const ex = (await c.query(`select id, nombre, laboratorio, ean, activo, maestro_id from productos where empresa_id = $1`, [s.empresa])).rows as Existente[];
    const porEan = new Map<string, Existente>(), porNombre = new Map<string, Existente>();
    for (const e of ex) {
      if (e.ean && (!porEan.has(e.ean) || e.activo)) porEan.set(e.ean, e);
      const k = claveNombre(e.nombre, e.laboratorio ?? "");
      if (!porNombre.has(k) || e.activo) porNombre.set(k, e);
    }
    const maestrosUsados = new Set(ex.map((e) => e.maestro_id).filter(Boolean));
    const eans = lec.productos.map((x) => x.ean).filter(Boolean);
    const maestro = new Map<string, string>((await c.query(`select ean, id from productos_maestro where ean = any($1)`, [eans])).rows.map((r) => [r.ean, r.id]));

    // A qué producto existente va cada fila. Si dos filas del archivo apuntan al mismo, se unen.
    const destino = new Map<Producto, Existente | null>();
    const tomados = new Map<string, Producto>();
    const unicos: Producto[] = [];
    for (const x of lec.productos) {
      const e = (x.ean && porEan.get(x.ean)) || porNombre.get(claveNombre(x.nombre, x.laboratorio)) || null;
      if (e && tomados.has(e.id)) {
        const otro = tomados.get(e.id)!;
        avisos.push({ fila: x.fila, texto: `es el mismo producto de la fila ${otro.fila} («${e.nombre}» ya está en tu droguería): se unen` });
        for (const l of x.lotes) { const y = otro.lotes.find((z) => z.lote === l.lote); if (y) { y.unidades += l.unidades; y.filas.push(...l.filas); } else otro.lotes.push(l); }
        continue;
      }
      if (e && e.ean && x.ean && e.ean !== x.ean) { destino.set(x, null); unicos.push(x); continue; } // mismo nombre, otro código: es otro producto
      if (e) tomados.set(e.id, x);
      destino.set(x, e); unicos.push(x);
    }

    // Lotes ya cargados: no se suman otra vez.
    const ids = [...destino.values()].filter(Boolean).map((e) => e!.id);
    const lotesYa = new Set((await c.query(`select producto_id || '|' || lote k from lotes where sede_id = $1 and producto_id = any($2)`, [sede, ids])).rows.map((r) => r.k as string));
    let unidades = 0, conStock = 0;
    const plan = unicos.map((x) => {
      const e = destino.get(x);
      const cargar = x.lotes.filter((l) => {
        if (e && lotesYa.has(`${e.id}|${l.lote}`)) { avisos.push({ fila: l.filas[0], texto: `el lote ${l.lote} de «${x.nombre}» ya está cargado: no se suma de nuevo (para corregir la cantidad usa «Ajustar» en Inventario)` }); return false; }
        return true;
      });
      x.lotes = cargar;
      const u = cargar.reduce((a, l) => a + l.unidades, 0);
      unidades += u; if (u) conStock++;
      return { fila: x.fila, nombre: x.nombre, accion: e ? (e.activo ? "actualizar" : "reactivar") : "crear", existencias: u };
    });
    const resumen = { crear: plan.filter((x) => x.accion === "crear").length, actualizar: plan.filter((x) => x.accion !== "crear").length, con_existencias: conStock, unidades };
    if (p.data.simular || lec.errores.length) return { plan: plan.slice(0, 500), resumen };

    // ── Aplicar en bloque (miles de filas en pocos segundos) ──
    const nuevos = unicos.filter((x) => !destino.get(x)).map((x) => {
      const id = randomUUID();
      destino.set(x, { id, nombre: x.nombre, laboratorio: x.laboratorio, ean: x.ean, activo: true, maestro_id: null });
      const m = x.ean ? maestro.get(x.ean) : undefined;
      const maestro_id = m && !maestrosUsados.has(m) ? (maestrosUsados.add(m), m) : null;
      return { id, maestro_id, nombre: x.nombre, laboratorio: x.laboratorio || null, ean: x.ean || null, iva: x.iva, unidades_por_caja: x.unidades_por_caja,
        precio_caja: x.precio_caja, precio_unidad: x.precio_unidad, stock_minimo: x.stock_minimo, registro_sanitario: x.registro_sanitario || null };
    });
    if (nuevos.length) await c.query(`insert into productos (id, empresa_id, maestro_id, nombre, laboratorio, ean, iva, unidades_por_caja, precio_caja, precio_unidad, stock_minimo, registro_sanitario)
      select id, $1, maestro_id, nombre, laboratorio, ean, iva, unidades_por_caja, precio_caja, precio_unidad, stock_minimo, registro_sanitario
      from jsonb_to_recordset($2) as x(id uuid, maestro_id uuid, nombre text, laboratorio text, ean text, iva numeric, unidades_por_caja int, precio_caja numeric, precio_unidad numeric, stock_minimo int, registro_sanitario text)`,
      [s.empresa, JSON.stringify(nuevos)]);

    // Existentes: solo se cambian las columnas que trae el archivo (si no trae IVA, el IVA de cada producto se respeta).
    const cols = lec.columnas;
    const tiene = (k: Campo) => cols.has(k);
    const sets = ["activo = true", "actualizado = now()", "nombre = x.nombre",
      tiene("laboratorio") && "laboratorio = coalesce(nullif(x.laboratorio, ''), p.laboratorio)",
      tiene("codigo_barras") && "ean = coalesce(nullif(x.ean, ''), p.ean)",
      tiene("iva") && "iva = x.iva",
      tiene("unidades_por_caja") && "unidades_por_caja = x.unidades_por_caja",
      (tiene("precio_caja") || tiene("unidades_por_caja")) ? "precio_caja = x.precio_caja"
        : "precio_caja = case when p.unidades_por_caja = 1 then x.precio_caja else p.precio_caja end", // solo trae precio por unidad
      tiene("unidades_por_caja") ? "precio_unidad = x.precio_unidad"
        : tiene("precio_unidad") && "precio_unidad = case when p.unidades_por_caja > 1 then coalesce(x.pu_archivo, p.precio_unidad) end",
      tiene("stock_minimo") && "stock_minimo = x.stock_minimo",
      tiene("registro_sanitario") && "registro_sanitario = coalesce(nullif(x.registro_sanitario, ''), p.registro_sanitario)"].filter(Boolean);
    const viejos = unicos.filter((x) => destino.get(x) && !nuevos.some((n) => n.id === destino.get(x)!.id)).map((x) => ({ id: destino.get(x)!.id, nombre: x.nombre, laboratorio: x.laboratorio, ean: x.ean,
      iva: x.iva, unidades_por_caja: x.unidades_por_caja, precio_caja: x.precio_caja, precio_unidad: x.precio_unidad, pu_archivo: x.pu_archivo, stock_minimo: x.stock_minimo, registro_sanitario: x.registro_sanitario }));
    if (viejos.length) await c.query(`update productos p set ${sets.join(", ")}
      from jsonb_to_recordset($2) as x(id uuid, nombre text, laboratorio text, ean text, iva numeric, unidades_por_caja int, precio_caja numeric, precio_unidad numeric, pu_archivo numeric, stock_minimo int, registro_sanitario text)
      where p.id = x.id and p.empresa_id = $1`, [s.empresa, JSON.stringify(viejos)]);

    const lineas = unicos.flatMap((x) => x.lotes.map((l) => ({ producto_id: destino.get(x)!.id, lote: l.lote, vence: l.vence, unidades: l.unidades, ...(l.costo !== undefined ? { costo_unidad: l.costo } : {}) })));
    if (lineas.length) await c.query(`select registrar_entrada($1)`, [{ empresa_id: s.empresa, sede_id: sede, tipo: "inicial", lineas, idem_key: p.data.idem_key ?? null }]);
    return { plan: plan.slice(0, 500), resumen, aplicado: true };
  });
  if ("aplicado" in resultado) await sinRLS((c) => c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'importar_productos', 'productos', 'archivo', $3)`,
    [s.empresa, s.uid, JSON.stringify(resultado.resumen)])).catch((e) => console.error("auditoría importar", e));
  avisos.sort((a, b) => a.fila - b.fila);
  return json({ ...resultado, errores: lec.errores.map((e) => ({ fila: e.fila, error: e.texto })), avisos: avisos.slice(0, 400), total_avisos: avisos.length });
});
