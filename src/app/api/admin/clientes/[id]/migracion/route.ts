import { z } from "zod";
import { NextResponse } from "next/server";
import { comoUsuario, puestoDeTrabajo, sinRLS, type Tx } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { claveNombre } from "@/lib/importar";

export const maxDuration = 26;

// Migración desde otro sistema (hoy Alegra) hecha por el equipo de Regenta desde la consola, en nombre del dueño.
// Cada parte se simula primero (dice qué va a pasar) y luego se aplica en UNA transacción. Repetible: nada se duplica.
//   · productos: crea o actualiza por el id del sistema anterior (o código de barras, o nombre) y deja las existencias
//     EXACTAMENTE como las trae el archivo («el sistema anterior manda»): lo que falta se ajusta con un ajuste de inventario
//     numerado (motivo «Diferencia de conteo», queda en el kardex con el antes y el después); los lotes nuevos entran como
//     inventario inicial con su costo. Con reemplazar=true, lo que la droguería tiene y el archivo no trae queda en cero.
//   · clientes y proveedores: por documento (sin duplicar); completan lo que falta, nunca borran un dato.
//   · ventas: historial de solo consulta; las que tienen saldo entran a la cartera como ventas a crédito «de Alegra».
// Nada de esto crea documentos ante la DIAN ni toca la caja.

const txt = (n: number) => z.string().trim().max(n);
const opc = (n: number) => txt(n).nullish().transform((v) => (v ? v : null));
const Producto = z.object({
  externo_id: txt(60).min(1), nombre: txt(200).min(2), ean: z.string().regex(/^\d{8,14}$/).nullish(),
  iva: z.union([z.literal(0), z.literal(5), z.literal(19)]), precio_caja: z.number().int().min(0).max(1e9), activo: z.boolean(),
  unidades: z.number().int().min(0).max(1e7), lote: opc(40), vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  costo_unidad: z.number().min(0).max(1e9).nullish(),
});
const Cliente = z.object({
  tipo_doc: z.enum(["CC", "NIT", "CE", "PP", "TI", "PEP"]), numero_doc: z.string().trim().regex(/^[0-9A-Za-z]{3,20}$/), dv: z.string().regex(/^\d$/).nullish(),
  nombre: txt(200).min(2), email: z.string().trim().email().max(160).nullish().catch(null), telefono: opc(30), direccion: opc(160), ciudad: opc(80),
});
const Proveedor = z.object({
  nombre: txt(160).min(2), nit: z.string().regex(/^\d{5,12}$/).nullish(), dv: z.string().regex(/^\d$/).nullish(), telefono: opc(30),
  email: z.string().trim().email().max(160).nullish().catch(null), direccion: opc(160), ciudad: opc(80), plazo_dias: z.number().int().min(0).max(365).nullish(),
});
const Linea = z.object({ producto_externo: opc(60), nombre: txt(200), cantidad: z.number(), precio: z.number(), descuento: z.number(), iva_pct: z.number(), total: z.number(), lote: opc(40), vence: opc(20) });
const Venta = z.object({
  externo_id: txt(40).min(1), documento: z.enum(["factura", "pos"]), prefijo: opc(10), numero: z.number().int().nullish(),
  fecha_hora: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/), vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  cliente_tipo: z.enum(["CC", "NIT", "CE", "PP", "TI", "PEP"]).nullish(), cliente_doc: opc(30), cliente_nombre: opc(200),
  subtotal: z.number(), descuento: z.number(), iva: z.number(), total: z.number(), pagado: z.number(), saldo: z.number().min(0),
  estado: z.enum(["pagada", "por_cobrar", "anulada", "borrador"]), estado_dian: opc(60), cufe: opc(200), forma_pago: opc(60), lineas: z.array(Linea).max(500),
}).refine((v) => v.numero != null || /^\d{1,15}$/.test(v.externo_id), { message: "Cada venta necesita su número (o un id numérico de Alegra)" })
  .refine((v) => v.total >= 0 && v.saldo <= v.total + 1 && v.pagado >= 0, { message: "Hay una venta con total negativo o con saldo mayor que su total: revisa el archivo" })
  .refine((v) => v.fecha_hora.slice(0, 10) <= new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), { message: "Hay una venta con fecha futura: revisa el archivo" });
const Peticion = z.discriminatedUnion("parte", [
  z.object({ parte: z.literal("productos"), simular: z.boolean(), reemplazar: z.boolean(), filas: z.array(Producto).min(1).max(5000)
    .superRefine((fs, ctx) => { const vistos = new Set<string>(), rep = new Set<string>(); for (const f of fs) (vistos.has(f.externo_id) ? rep : vistos).add(f.externo_id);
      if (rep.size) ctx.addIssue({ code: "custom", message: `El archivo repite el id de Alegra de ${rep.size} producto(s): ${[...rep].slice(0, 5).join(", ")}` }); }) }),
  z.object({ parte: z.literal("clientes"), simular: z.boolean(), filas: z.array(Cliente).min(1).max(5000) }),
  z.object({ parte: z.literal("proveedores"), simular: z.boolean(), filas: z.array(Proveedor).min(1).max(1000) }),
  z.object({ parte: z.literal("ventas"), simular: z.boolean(), filas: z.array(Venta).min(1).max(400) }),
]);
type P = z.infer<typeof Peticion>;
const ORIGEN = "alegra";
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

export const POST = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Peticion.safeParse(await req.json().catch(() => null));
  if (!p.success) { const i = p.error.issues[0]; return NextResponse.json({ error: `${i?.path.join(".")}: ${i?.message}` }, { status: 400 }); }
  const dueno = (await sinRLS((c) => c.query(`select m.user_id from miembros m join empresas e on e.id = m.empresa_id
    where m.empresa_id = $1 and m.rol = 'dueno' and m.activo and not e.demo order by m.creado limit 1`, [id]))).rows[0]?.user_id as string | undefined;
  if (!dueno) return NextResponse.json({ error: "Cliente no encontrado o sin dueño activo" }, { status: 404 });
  const d = p.data;
  const r = d.parte === "productos" ? await productos(id, dueno, a.uid, d)
    : d.parte === "clientes" ? await clientes(id, d) : d.parte === "proveedores" ? await proveedores(id, d) : await ventas(id, dueno, d);
  if (!d.simular) await evento(a, `migracion_${d.parte}`, id, { origen: ORIGEN, filas: d.filas.length, resumen: (r as { resumen: unknown }).resumen });
  return NextResponse.json(r);
});

/** Corre `fn` y, si es simulación, deshace todo al final (lo que devuelve es exactamente lo que pasaría). */
class Simulado { constructor(public r: unknown) {} }
/** Error que se le muestra a soporte tal cual (la consola lo responde como 400 con este mensaje). */
const aviso = (mensaje: string) => Object.assign(new Error(mensaje), { code: "P0001" });
async function talCual<T>(simular: boolean, correr: (fn: (c: Tx) => Promise<T>) => Promise<T>, fn: (c: Tx) => Promise<T>): Promise<T> {
  try { return await correr(async (c) => { const r = await fn(c); if (simular) throw new Simulado(r); return r; }); }
  catch (e) { if (e instanceof Simulado) return e.r as T; throw e; }
}

async function productos(emp: string, dueno: string, admin: string, d: Extract<P, { parte: "productos" }>) {
  return talCual(d.simular, (fn) => comoUsuario({ uid: dueno, soporte: admin }, fn), async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtext('importar:' || $1))`, [emp]);
    const sede = (await puestoDeTrabajo(c, emp)).sede_id;
    const ex = (await c.query(`select id, nombre, laboratorio, ean, externo_id, activo, unidades_por_caja upc from productos where empresa_id = $1`, [emp])).rows as
      { id: string; nombre: string; laboratorio: string | null; ean: string | null; externo_id: string | null; activo: boolean; upc: number }[];
    const porExt = new Map(ex.filter((e) => e.externo_id).map((e) => [e.externo_id!, e]));
    const porEan = new Map(ex.filter((e) => e.ean).map((e) => [e.ean!, e]));
    const porNombre = new Map<string, (typeof ex)[number]>();
    for (const e of ex) { const k = claveNombre(e.nombre, ""), k2 = claveNombre(e.nombre, e.laboratorio ?? ""); for (const x of [k, k2]) if (!porNombre.has(x) || e.activo) porNombre.set(x, e); }
    const usados = new Set<string>();
    const resumen = { crear: 0, actualizar: 0, por_ean: 0, por_nombre: 0, lotes_nuevos: 0, lotes_ajustados: 0, en_cero: 0, unidades: 0, valor_costo: 0 };
    const detalle: { nombre: string; accion: string; antes: number; despues: number }[] = [];
    const destino: string[] = [];
    // Cada artículo de Alegra es una unidad de venta: en un producto que ya existía con N unidades por caja, esa unidad es
    // la caja (el precio de Alegra pasa a ser el precio de la caja), así que las existencias y el costo se llevan a unidades.
    const factor: number[] = [];
    for (const f of d.filas) {
      let e = porExt.get(f.externo_id);
      if (!e && f.ean && porEan.get(f.ean) && !porEan.get(f.ean)!.externo_id) { e = porEan.get(f.ean); resumen.por_ean++; }
      if (!e) { const x = porNombre.get(claveNombre(f.nombre, "")); if (x && !x.externo_id && !usados.has(x.id)) { e = x; resumen.por_nombre++; } }
      if (e && usados.has(e.id)) e = undefined; // dos filas del archivo no pueden caer en el mismo producto
      if (e) {
        usados.add(e.id); resumen.actualizar++;
        await c.query(`update productos set externo_id = $2, nombre = $3, ean = coalesce($4, ean), iva = $5, precio_caja = $6,
          precio_unidad = case when unidades_por_caja > 1 then precio_unidad end, activo = $7 or $8 > 0, actualizado = now() where id = $1`,
          [e.id, f.externo_id, f.nombre, f.ean ?? null, f.iva, f.precio_caja, f.activo, f.unidades]);
        destino.push(e.id); factor.push(Math.max(1, e.upc));
      } else {
        resumen.crear++;
        const nuevo = (await c.query(`insert into productos (empresa_id, externo_id, nombre, ean, iva, unidades_por_caja, precio_caja, activo)
          values ($1, $2, $3, $4, $5, 1, $6, $7) returning id`, [emp, f.externo_id, f.nombre, f.ean ?? null, f.iva, f.precio_caja, f.activo || f.unidades > 0])).rows[0].id as string;
        usados.add(nuevo); destino.push(nuevo); factor.push(1);
      }
    }
    // Existencias: el archivo manda. Estado actual por lote (sede principal).
    const ids = d.reemplazar ? (await c.query(`select id from productos where empresa_id = $1`, [emp])).rows.map((x) => x.id as string) : destino;
    const lotes = (await c.query(`select l.lote_id, l.producto_id, l.lote, l.vence::text, l.unidades from v_stock_lotes l
      where l.empresa_id = $1 and l.sede_id = $2 and l.producto_id = any($3)`, [emp, sede, ids])).rows as { lote_id: string; producto_id: string; lote: string; vence: string | null; unidades: number }[];
    const objetivo = new Map<string, { lote: string; vence: string | null; unidades: number; costo: number | null; nombre: string }>();
    d.filas.forEach((f, i) => { if (f.unidades > 0) objetivo.set(destino[i], { lote: (f.lote || "SIN-LOTE").toUpperCase().trim(), vence: f.vence ?? null,
      unidades: f.unidades * factor[i], costo: f.costo_unidad == null ? null : f.costo_unidad / factor[i], nombre: f.nombre }); });
    const ajuste: { lote_id: string; unidades: number }[] = [];
    const entradas: { inicial: object[]; vencidas: object[] } = { inicial: [], vencidas: [] };
    const nombres = new Map(d.filas.map((f, i) => [destino[i], f.nombre]));
    for (const pid of new Set(ids)) {
      const o = objetivo.get(pid);
      const suyos = lotes.filter((l) => l.producto_id === pid);
      const antes = suyos.reduce((s, l) => s + l.unidades, 0);
      let mismo = o ? suyos.find((l) => l.lote === o.lote) : undefined;
      if (mismo && o && o.vence && mismo.vence && mismo.vence !== o.vence) mismo = undefined; // mismo código, otra fecha: es otro lote
      for (const l of suyos) { const quiere = l === mismo ? o!.unidades : 0; if (quiere !== l.unidades) ajuste.push({ lote_id: l.lote_id, unidades: quiere - l.unidades }); }
      if (mismo) resumen.lotes_ajustados += mismo.unidades !== o!.unidades ? 1 : 0;
      if (o && !mismo) {
        const lote = suyos.some((l) => l.lote === o.lote) ? `${o.lote}-A` : o.lote; // mismo código con otra fecha en la sede
        const linea = { producto_id: pid, lote, vence: o.vence, unidades: o.unidades, ...(o.costo !== null ? { costo_unidad: o.costo } : {}) };
        (o.vence && o.vence < hoy() ? entradas.vencidas : entradas.inicial).push(linea);
        resumen.lotes_nuevos++;
      }
      const despues = o?.unidades ?? 0;
      if (!o && antes > 0) resumen.en_cero++;
      resumen.unidades += despues; resumen.valor_costo += despues * (o?.costo ?? 0);
      if (antes !== despues) detalle.push({ nombre: nombres.get(pid) ?? ex.find((x) => x.id === pid)?.nombre ?? pid, accion: !o ? "queda en cero" : antes ? "se ajusta" : "entra", antes, despues });
    }
    const motivo = `Migración desde Alegra: existencias al ${hoy()}`;
    if (entradas.inicial.length) await c.query(`select registrar_entrada($1)`, [{ empresa_id: emp, sede_id: sede, tipo: "inicial", lineas: entradas.inicial }]);
    if (entradas.vencidas.length) await c.query(`select registrar_entrada($1)`, [{ empresa_id: emp, sede_id: sede, tipo: "ajuste", motivo: `${motivo} (lotes ya vencidos)`, lineas: entradas.vencidas }]);
    if (ajuste.length) await c.query(`select registrar_ajuste($1)`, [{ empresa_id: emp, motivo: "conteo", detalle: motivo, lineas: ajuste }]);
    // Comprobación: lo que quedó es lo que pide el archivo, producto por producto.
    const quedo = new Map((await c.query(`select producto_id, sum(unidades)::int u from v_stock_lotes where empresa_id = $1 and sede_id = $2 and producto_id = any($3) group by 1`, [emp, sede, ids])).rows.map((x) => [x.producto_id as string, x.u as number]));
    const mal = [...new Set(ids)].filter((pid) => (quedo.get(pid) ?? 0) !== (objetivo.get(pid)?.unidades ?? 0));
    if (mal.length) throw aviso(`Las existencias no cuadran en ${mal.length} productos tras la migración`);
    return { resumen: { ...resumen, valor_costo: Math.round(resumen.valor_costo) }, cambios: detalle.sort((x, y) => x.nombre.localeCompare(y.nombre)).slice(0, 1500), simulado: d.simular };
  });
}

async function clientes(emp: string, d: Extract<P, { parte: "clientes" }>) {
  return talCual(d.simular, sinRLS, async (c) => {
    const resumen = { crear: 0, completar: 0, iguales: 0 };
    for (const f of d.filas) {
      const r = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, dv, nombre, email, telefono, direccion, ciudad)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (empresa_id, tipo_doc, numero_doc) do update set dv = coalesce(clientes.dv, excluded.dv), email = coalesce(clientes.email, excluded.email),
          telefono = coalesce(clientes.telefono, excluded.telefono), direccion = coalesce(clientes.direccion, excluded.direccion), ciudad = coalesce(clientes.ciudad, excluded.ciudad)
        where (clientes.dv is null and excluded.dv is not null) or (clientes.email is null and excluded.email is not null) or (clientes.telefono is null and excluded.telefono is not null)
          or (clientes.direccion is null and excluded.direccion is not null) or (clientes.ciudad is null and excluded.ciudad is not null)
        returning (xmax = 0) nuevo`, [emp, f.tipo_doc, f.numero_doc.toUpperCase(), f.dv ?? null, f.nombre, f.email?.toLowerCase() ?? null, f.telefono, f.direccion, f.ciudad])).rows[0];
      if (!r) resumen.iguales++; else if (r.nuevo) resumen.crear++; else resumen.completar++;
    }
    return { resumen, simulado: d.simular };
  });
}

async function proveedores(emp: string, d: Extract<P, { parte: "proveedores" }>) {
  return talCual(d.simular, sinRLS, async (c) => {
    const resumen = { crear: 0, completar: 0, iguales: 0 };
    for (const f of d.filas) {
      const e = (await c.query(`select id from proveedores where empresa_id = $1 and ((nit is not null and nit = $2) or lower(trim(nombre)) = lower(trim($3))) order by (nit = $2) desc nulls last limit 1`, [emp, f.nit ?? null, f.nombre])).rows[0];
      if (e) {
        await c.query(`update proveedores set nit = coalesce(nit, $2), dv = coalesce(dv, $3), telefono = coalesce(telefono, $4), email = coalesce(email, $5),
          direccion = coalesce(direccion, $6), ciudad = coalesce(ciudad, $7), plazo_dias = coalesce(plazo_dias, $8)
          where id = $1 and (nit is null and $2::text is not null or dv is null and $3::text is not null or telefono is null and $4::text is not null
            or email is null and $5::text is not null or direccion is null and $6::text is not null or ciudad is null and $7::text is not null or plazo_dias is null and $8::int is not null)`,
          [e.id, f.nit ?? null, f.dv ?? null, f.telefono, f.email?.toLowerCase() ?? null, f.direccion, f.ciudad, f.plazo_dias ?? null]).then((r) => r.rowCount ? resumen.completar++ : resumen.iguales++);
      } else {
        await c.query(`insert into proveedores (empresa_id, nombre, nit, dv, telefono, email, direccion, ciudad, plazo_dias) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [emp, f.nombre, f.nit ?? null, f.dv ?? null, f.telefono, f.email?.toLowerCase() ?? null, f.direccion, f.ciudad, f.plazo_dias ?? null]);
        resumen.crear++;
      }
    }
    return { resumen, simulado: d.simular };
  });
}

async function ventas(emp: string, dueno: string, d: Extract<P, { parte: "ventas" }>) {
  return talCual(d.simular, sinRLS, async (c) => {
    const sede = (await c.query(`select id from sedes where empresa_id = $1 order by creado limit 1`, [emp])).rows[0]?.id as string;
    const cli = new Map((await c.query(`select id, tipo_doc || ':' || numero_doc k from clientes where empresa_id = $1`, [emp])).rows.map((x) => [x.k as string, x.id as string]));
    const resumen = { historial_nuevas: 0, historial_ya_estaban: 0, historial_actualizadas: 0, cartera_nuevas: 0, cartera_ya_estaban: 0, saldo_cartera: 0, sin_cliente: 0, plazo_recortado: 0,
      cartera_pagada_en_alegra: 0, valor_pagado_en_alegra: 0 };
    for (const f of d.filas) {
      const cid = f.cliente_doc ? cli.get(`${f.cliente_tipo ?? "CC"}:${f.cliente_doc.toUpperCase()}`) ?? null : null;
      if (f.cliente_doc && !cid) resumen.sin_cliente++;
      const h = await c.query(`insert into ventas_externas (empresa_id, origen, externo_id, documento, prefijo, numero, fecha, vence, cliente_id, cliente_nombre, cliente_doc,
          subtotal, descuento, iva, total, pagado, saldo, estado, estado_dian, cufe, forma_pago, lineas)
        values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        on conflict (empresa_id, origen, externo_id) do update set estado = excluded.estado, pagado = excluded.pagado, saldo = excluded.saldo,
          estado_dian = excluded.estado_dian, cufe = excluded.cufe
        where (ventas_externas.estado, ventas_externas.pagado, ventas_externas.saldo, ventas_externas.estado_dian, ventas_externas.cufe)
          is distinct from (excluded.estado, excluded.pagado, excluded.saldo, excluded.estado_dian, excluded.cufe)
        returning (xmax = 0) nueva`,
        [emp, ORIGEN, f.externo_id, f.documento, f.prefijo, f.numero ?? null, f.fecha_hora.slice(0, 10), f.vence ?? null, cid, f.cliente_nombre, f.cliente_doc,
          f.subtotal, f.descuento, f.iva, f.total, f.pagado, f.saldo, f.estado, f.estado_dian, f.cufe, f.forma_pago, JSON.stringify(f.lineas)]);
      // Repetir la migración pone al día el estado y el saldo que tenga Alegra (pagos recibidos allá durante el cambio).
      if (!h.rowCount) resumen.historial_ya_estaban++; else if (h.rows[0].nueva) resumen.historial_nuevas++; else resumen.historial_actualizadas++;
      // Factura que ya está en la cartera de Regenta: si en Alegra le entró un pago (o quedó pagada o anulada) durante el
      // cambio, la diferencia entra como abono «pagado en Alegra», para no cobrarle al cliente lo que ya pagó.
      const enCartera = (await c.query(`select id, saldo_factura(id)::float saldo from ventas where empresa_id = $1 and origen = $2 and externo_id = $3`, [emp, ORIGEN, f.externo_id])).rows[0];
      if (enCartera) {
        const quiere = f.estado === "por_cobrar" ? f.saldo : 0;
        const pagado = Math.round(enCartera.saldo - quiere);
        if (pagado > 0) {
          const medio = ({ efectivo: "efectivo", transferencia: "transferencia", tarjeta: "tarjeta" } as Record<string, string>)[String(f.forma_pago ?? "").toLowerCase()] ?? "transferencia";
          await c.query(`insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id) values ($1, $2, $3, $4, 'Pagado en Alegra (migración)', $5)`,
            [emp, enCartera.id, medio, pagado, dueno]);
          await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'abono_pagado_en_alegra', 'ventas', $3, $4)`,
            [emp, dueno, enCartera.id, { externo_id: f.externo_id, valor: pagado, estado_alegra: f.estado, saldo_alegra: f.saldo }]);
          resumen.cartera_pagada_en_alegra++; resumen.valor_pagado_en_alegra += pagado;
        }
        resumen.cartera_ya_estaban++;
        continue;
      }
      if (f.estado !== "por_cobrar" || f.saldo <= 0) continue;
      if (!cid) {
        if (d.simular) { resumen.cartera_nuevas++; resumen.saldo_cartera += f.saldo; continue; } // al simular, los clientes aún no se han cargado
        throw aviso(`La factura ${f.prefijo ?? ""}${f.numero ?? ""} tiene saldo pero su cliente (${f.cliente_doc}) no está: carga primero los clientes`);
      }
      // Cartera: la factura abierta, con lo que falta por cobrar (lo ya pagado en Alegra no se vuelve a cobrar aquí) y el
      // mismo vencimiento que tenía en Alegra (el plazo, en días, nunca baja de 1).
      const fecha = f.fecha_hora.slice(0, 10), vence = f.vence && f.vence > fecha ? f.vence : fecha;
      const dias = Math.max(1, Math.round((Date.parse(vence) - Date.parse(fecha)) / 864e5));
      const plazo = Math.min(180, dias); // Regenta admite crédito hasta 180 días; el vencimiento queda el de Alegra
      if (dias > 180) resumen.plazo_recortado++;
      const prefijo = f.prefijo ?? "ALG", numero = f.numero ?? Number(f.externo_id);
      // Una venta de Regenta (u otra de Alegra) con el mismo tipo, prefijo y número: no se descarta en silencio.
      const choca = (await c.query(`select 1 from ventas where empresa_id = $1 and tipo_doc = $2 and prefijo = $3 and numero = $4
        and (origen is distinct from $5 or externo_id is distinct from $6)`, [emp, f.documento, prefijo, numero, ORIGEN, f.externo_id])).rowCount;
      if (choca) throw aviso(`La factura ${prefijo}${numero} de Alegra tiene el mismo número que otra venta en Regenta: revisa la numeración antes de migrar la cartera`);
      const v = await c.query(`insert into ventas (empresa_id, sede_id, caja_id, cliente_id, usuario_id, idem_key, tipo_doc, prefijo, numero, base, iva, total, recibido, cambio,
          creado, condicion, plazo_dias, vence_pago, origen, externo_id)
        values ($1, $2, null, $3, $4, $5, $6, $7, $8, $9, 0, $9, 0, 0, ($10::timestamp at time zone 'America/Bogota'), 'credito', $11::int, $12::date, $13, $14)
        on conflict (empresa_id, origen, externo_id) where origen is not null do nothing`,
        [emp, sede, cid, dueno, `${ORIGEN}:${f.externo_id}`, f.documento, prefijo, numero, f.saldo,
          f.fecha_hora.length > 10 ? f.fecha_hora : `${f.fecha_hora} 12:00`, plazo, vence, ORIGEN, f.externo_id]);
      if (v.rowCount) { resumen.cartera_nuevas++; resumen.saldo_cartera += f.saldo; } else resumen.cartera_ya_estaban++;
    }
    return { resumen, simulado: d.simular };
  });
}
