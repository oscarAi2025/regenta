import "server-only";
import type { Rol } from "./sesion";
import type { Tx } from "./db";
import { pesos } from "./formato";

/** Permisos de cuentas de clientes y cartera (la base de datos los vuelve a comprobar siempre). */
export const permisoCartera = {
  /** Ver el crédito de un cliente en la caja (cupo, motivo): quien vende. */
  verCredito: (r: Rol) => r === "dueno" || r === "admin" || r === "cajero",
  /** Recibir pagos de clientes (recibo de caja): quien vende; la cajera, con su turno abierto. */
  recibir: (r: Rol) => r === "dueno" || r === "admin" || r === "cajero",
  /** Cupo, plazo, bloqueo, notas, límite de mora, anular recibos, ficha y estado de cuenta: la gerencia. */
  gestionar: (r: Rol) => r === "dueno" || r === "admin",
};

export type Credito = {
  puede_fiar: boolean; requiere_motivo: boolean; motivo: string | null; aviso: string | null;
  cupo: number | null; cupo_disponible: number | null; saldo: number; facturas: number; dias_mora: number;
  limite_mora: number | null; bloqueado: boolean; plazo_dias: number | null;
};
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export function normalizarCredito(j: Record<string, unknown>): Credito {
  return {
    puede_fiar: !!j.puede_fiar, requiere_motivo: !!j.requiere_motivo, motivo: (j.motivo as string) ?? null, aviso: (j.aviso as string) ?? null,
    cupo: num(j.cupo), cupo_disponible: num(j.cupo_disponible), saldo: Number(j.saldo ?? 0), facturas: Number(j.facturas ?? 0),
    dias_mora: Number(j.dias_mora ?? 0), limite_mora: num(j.limite_mora), bloqueado: !!j.bloqueado, plazo_dias: num(j.plazo_dias),
  };
}

/** Edades de la cartera: días desde el vencimiento de cada factura (0 = al día o aún no vence). */
export const EDADES = [
  { k: "e0", t: "0–30 días", min: 0, max: 30 },
  { k: "e31", t: "31–60 días", min: 31, max: 60 },
  { k: "e61", t: "61–90 días", min: 61, max: 90 },
  { k: "e91", t: "Más de 90 días", min: 91, max: 100000 },
] as const;
export type Edad = (typeof EDADES)[number]["k"];
export const esEdad = (v: unknown): v is Edad => EDADES.some((e) => e.k === v);

export type FilaCliente = { cliente_id: string; cliente: string; documento: string; telefono: string | null; cupo: number | null; bloqueado: boolean;
  facturas: number; saldo: number; e0: number; e31: number; e61: number; e91: number; mora: number };

/** Cartera agrupada por cliente con sus edades (solo gerencia: lee v_cartera). */
export async function carteraPorCliente(c: Tx, empresa: string, edad?: Edad | null, q = ""): Promise<FilaCliente[]> {
  const filtro = edad ? (() => { const e = EDADES.find((x) => x.k === edad)!; return `and sum(vc.saldo) filter (where vc.dias_mora between ${e.min} and ${e.max}) > 0`; })() : "";
  const t = q.replace(/\0/g, "").trim().toLowerCase().slice(0, 80);
  return (await c.query(`
    select vc.cliente_id, vc.cliente, vc.tipo_doc || ' ' || vc.numero_doc || coalesce('-' || vc.dv, '') documento, vc.telefono,
           cl.cupo_credito::float cupo, cl.credito_bloqueado bloqueado, count(*)::int facturas, sum(vc.saldo)::float saldo,
           ${EDADES.map((e) => `coalesce(sum(vc.saldo) filter (where vc.dias_mora between ${e.min} and ${e.max}), 0)::float ${e.k}`).join(", ")},
           max(vc.dias_mora)::int mora
    from v_cartera vc join clientes cl on cl.id = vc.cliente_id
    where vc.empresa_id = $1 and vc.saldo > 0
      and ($2 = '' or lower(vc.cliente) like '%' || $3 || '%' or vc.numero_doc like $3 || '%')
    group by vc.cliente_id, vc.cliente, vc.tipo_doc, vc.numero_doc, vc.dv, vc.telefono, cl.cupo_credito, cl.credito_bloqueado
    having true ${filtro}
    order by sum(vc.saldo) desc, vc.cliente limit 500`, [empresa, t, t.replace(/[\\%_]/g, (m) => "\\" + m)])).rows;
}

export type Movimiento = { fecha: string; orden: string; tipo: "factura" | "abono" | "recibo" | "devolucion"; detalle: string; cargo: number; abono: number; valor: number;
  anulado?: boolean; enlace?: string; saldo?: number };
export type Pendiente = { venta_id: string; factura: string; fecha: string; vence: string; total: number; abonado: number; saldo: number; dias_mora: number };
export type Recibo = { id: number; numero: number; fecha: string; medio: string; valor: number; referencia: string | null; anulado: boolean; motivo: string | null; quien: string | null };

/** Estado de cuenta de un cliente: facturas a crédito, devoluciones (notas crédito), abonos y recibos de caja, con saldo
 *  acumulado. El saldo final es la suma del saldo de sus facturas en v_cartera (cuadra con la cartera). Solo gerencia. */
export async function estadoCuenta(c: Tx, empresa: string, cliente: string) {
  const cl = (await c.query(`select id, tipo_doc, numero_doc, dv, nombre, email, telefono, autoriza_datos, cupo_credito::float cupo, plazo_dias_defecto plazo,
      credito_bloqueado bloqueado, notas, to_char(creado at time zone 'America/Bogota', 'DD/MM/YYYY') desde
    from clientes where id = $1 and empresa_id = $2`, [cliente, empresa])).rows[0];
  if (!cl) return null;
  const f = (col: string) => `to_char(${col} at time zone 'America/Bogota', 'DD/MM/YYYY')`;
  const facturas = (await c.query(`select v.id, v.prefijo || v.numero factura, ${f("v.creado")} fecha, v.creado::text orden, to_char(v.vence_pago, 'DD/MM/YYYY') vence, v.total::float total
    from ventas v where v.empresa_id = $1 and v.cliente_id = $2 and v.condicion = 'credito' and v.estado = 'cerrada'`, [empresa, cliente])).rows;
  const devoluciones = (await c.query(`select d.id, ${f("d.creado")} fecha, d.creado::text orden, d.total::float total, d.a_saldo::float a_saldo, d.reembolso::float reembolso,
      v.prefijo || v.numero factura, (select dd.prefijo || dd.numero from documentos_dian dd where dd.devolucion_id = d.id) nota
    from devoluciones d join ventas v on v.id = d.venta_id
    where v.empresa_id = $1 and v.cliente_id = $2 and v.condicion = 'credito' and v.estado = 'cerrada'`, [empresa, cliente])).rows;
  const abonos = (await c.query(`select a.id, ${f("a.creado")} fecha, a.creado::text orden, a.valor::float valor, a.medio, a.referencia, a.anulado, v.prefijo || v.numero factura, v.id venta_id
    from abonos a join ventas v on v.id = a.venta_id
    where v.empresa_id = $1 and v.cliente_id = $2 and v.condicion = 'credito' and v.estado = 'cerrada' and a.recibo_id is null`, [empresa, cliente])).rows;
  const recibos: (Recibo & { orden: string; facturas: string })[] = (await c.query(`select r.id::int, r.numero, ${f("r.creado")} fecha, r.creado::text orden, r.medio, r.valor::float valor,
      r.referencia, r.anulado, r.motivo, m.nombre quien,
      (select string_agg(e ->> 'factura', ', ') from jsonb_array_elements(r.aplicado) e) facturas
    from recibos_caja r left join miembros m on m.empresa_id = r.empresa_id and m.user_id = r.usuario_id
    where r.empresa_id = $1 and r.cliente_id = $2 order by r.creado desc`, [empresa, cliente])).rows;
  const pendientes: Pendiente[] = (await c.query(`select venta_id, prefijo || numero factura, to_char(creado at time zone 'America/Bogota', 'DD/MM/YYYY') fecha,
      to_char(vence_pago, 'DD/MM/YYYY') vence, total::float, abonado::float, saldo::float, dias_mora
    from v_cartera where empresa_id = $1 and cliente_id = $2 and saldo > 0 order by vence_pago, creado`, [empresa, cliente])).rows;
  const saldoCartera = Number((await c.query(`select coalesce(sum(saldo), 0)::float s from v_cartera where empresa_id = $1 and cliente_id = $2`, [empresa, cliente])).rows[0].s);

  const MEDIO_T: Record<string, string> = { efectivo: "efectivo", nequi: "Nequi", daviplata: "Daviplata", bre_b: "Bre-B", transferencia: "transferencia", tarjeta: "tarjeta", qr: "QR" };
  const movs: Movimiento[] = [
    ...facturas.map((x) => ({ fecha: x.fecha, orden: x.orden, tipo: "factura" as const, detalle: `Factura ${x.factura} · vence ${x.vence}`, cargo: x.total, abono: 0, valor: x.total, enlace: `/ventas/${x.id}` })),
    ...devoluciones.filter((x) => x.a_saldo > 0).map((x) => ({ fecha: x.fecha, orden: x.orden, tipo: "devolucion" as const,
      detalle: `Devolución de ${x.factura}${x.nota ? ` · nota crédito ${x.nota}` : ""}${x.reembolso > 0 ? ` (se le reembolsaron ${pesos(x.reembolso)})` : ""}`, cargo: 0, abono: x.a_saldo, valor: x.a_saldo })),
    ...abonos.map((x) => ({ fecha: x.fecha, orden: x.orden, tipo: "abono" as const, detalle: `Abono a ${x.factura} · ${MEDIO_T[x.medio] ?? x.medio}${x.referencia ? ` · ${x.referencia}` : ""}`,
      cargo: 0, abono: x.anulado ? 0 : x.valor, valor: x.valor, anulado: x.anulado })),
    ...recibos.map((x) => ({ fecha: x.fecha, orden: x.orden, tipo: "recibo" as const, detalle: `Recibo de caja RC-${x.numero} · ${MEDIO_T[x.medio] ?? x.medio}${x.facturas ? ` · ${x.facturas}` : ""}`,
      cargo: 0, abono: x.anulado ? 0 : x.valor, valor: x.valor, anulado: x.anulado, enlace: `/tiquete/recibo/${x.id}` })),
  ].sort((a, b) => a.orden.localeCompare(b.orden));
  let s = 0;
  for (const m of movs) { s += m.cargo - m.abono; m.saldo = Math.round(s * 100) / 100; }
  return { cliente: cl, movimientos: movs, pendientes, recibos, saldo: Math.round(s * 100) / 100, saldoCartera,
    cargos: movs.reduce((a, m) => a + m.cargo, 0), abonos: movs.reduce((a, m) => a + m.abono, 0) };
}

/** Enlace de WhatsApp con el estado de cuenta en texto (celular colombiano de 10 dígitos → +57). */
export function whatsappEstado(telefono: string | null, empresa: string, cliente: string, saldo: number, pendientes: Pendiente[], hoy: string) {
  const d = (telefono ?? "").replace(/\D/g, "");
  const numero = /^3\d{9}$/.test(d) ? `57${d}` : /^573\d{9}$/.test(d) ? d : "";
  const lineas = pendientes.slice(0, 12).map((p) => `• ${p.factura} vence ${p.vence}: ${pesos(p.saldo)}${p.dias_mora > 0 ? ` (${p.dias_mora} días de mora)` : ""}`);
  const texto = [`Hola, ${cliente}. Este es tu estado de cuenta con ${empresa} al ${hoy}:`, "", ...lineas, ...(pendientes.length > 12 ? [`… y ${pendientes.length - 12} facturas más`] : []), "",
    `Saldo total: ${pesos(saldo)}`, "", "Gracias por tu pago."].join("\n");
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

export const hoyBogota = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }).split("-").reverse().join("/");
