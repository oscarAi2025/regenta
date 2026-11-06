import "server-only";
import { z } from "zod";
import "../zod-es";
import type { Tx } from "../db";
import type { Rol } from "../sesion";
import { envioMatias, type TipoComplementario } from "./matias";

// Documento soporte (compras a proveedores no obligados a facturar), su nota de ajuste y la nota débito de una factura.
// Las reglas viven en la base (generar_soporte, ajustar_soporte, nota_debito); aquí van los permisos, la validación de
// entrada y las consultas de las pantallas.

/** Permisos de los documentos complementarios (la base de datos los vuelve a comprobar). */
export const puedeDian = {
  /** Generar documento soporte, notas de ajuste y notas débito; ver y descargar XML. */
  emitir: (r: Rol) => r === "dueno" || r === "admin",
};

const uuid = z.string().uuid("Documento no válido");
const idem = z.string().trim().min(8).max(80).nullish();
const dosDecimales = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

export const SoporteNuevo = z.object({
  compras: z.array(z.string().uuid("Compra no válida")).min(1, "Elige la compra").max(200, "Máximo 200 compras"),
  semanal: z.boolean().default(false),
  idem_key: idem,
});
export const AjusteNuevo = z.discriminatedUnion("concepto", [
  z.object({ concepto: z.literal("anulacion"), motivo: z.string().trim().min(4, "Escribe el motivo de la nota de ajuste").max(300), idem_key: idem }),
  z.object({
    concepto: z.literal("correccion"), motivo: z.string().trim().min(4, "Escribe el motivo de la nota de ajuste").max(300), idem_key: idem,
    descripcion: z.string().trim().min(2, "Escribe qué se corrige").max(300),
    valor: z.number({ invalid_type_error: "Escribe el valor sin IVA" }).positive("Escribe el valor sin IVA").max(10_000_000_000).refine(dosDecimales, "Máximo dos decimales"),
    iva_pct: z.union([z.literal(0), z.literal(5), z.literal(19)]).default(0),
  }),
], { errorMap: () => ({ message: "Elige si la nota anula o corrige el documento" }) });
export const NotaDebitoNueva = z.object({
  documento_id: uuid,
  motivo: z.string().trim().min(4, "Escribe el motivo de la nota débito").max(300),
  lineas: z.array(z.object({
    descripcion: z.string().trim().min(2, "Escribe el concepto de cada línea").max(300),
    cantidad: z.number().positive("Revisa la cantidad").max(100000).default(1),
    valor: z.number({ invalid_type_error: "Escribe el valor sin IVA" }).positive("Escribe el valor sin IVA de cada línea").max(1_000_000_000).refine(dosDecimales, "Máximo dos decimales"),
    iva_pct: z.union([z.literal(0), z.literal(5), z.literal(19)]).default(0),
  })).min(1, "Agrega al menos un concepto con su valor").max(50),
  idem_key: idem,
});

/** Antes de gastar un número: si la numeración del tipo es de producción y el servidor envía de verdad a MATIAS, el envío
 *  de ese tipo debe estar configurado y activado para la droguería. Devuelve el mensaje que impide generar, o null. */
export async function bloqueoEnvio(c: Tx, empresa: string, tipo: TipoComplementario): Promise<string | null> {
  const r = (await c.query(`select r.pruebas, e.demo, e.dian_complementario from empresas e left join resoluciones_dian r on r.empresa_id = e.id and r.tipo = $2 and r.activa
    where e.id = $1`, [empresa, tipo])).rows[0];
  if (!r || r.pruebas === null || r.pruebas || r.demo) return null; // sin numeración o de pruebas: la base da el mensaje; la demo siempre simula
  if ((process.env.REGENTA_DIAN ?? "simulado") !== "matias") return null; // la cola lo rechaza con su mensaje («configure MATIAS»)
  const e = envioMatias(tipo, !!r.dian_complementario);
  return e.habilitado ? null : e.mensaje;
}

export type DocSoporte = {
  id: string; tipo: "soporte" | "ajuste_soporte"; numero: string; estado: string; simulado: boolean; cufe: string | null; fecha: string; total: number;
  semanal: boolean; periodo_desde: string | null; periodo_hasta: string | null; concepto: string | null; motivo: string | null; ultimo_error: string | null;
  xml: boolean; pdf: string | null; compras: { id: string; numero: number; numero_factura: string }[];
};
export type EstadoSoporte = {
  compra: { id: string; numero: number; estado: string; proveedor_id: string; proveedor: string; proveedor_nit: string | null; obligado: boolean; fecha_factura: string; total: number };
  vigente: (DocSoporte & { ajustes: DocSoporte[]; disponible: number; anulado: boolean; tarifas: number[] }) | null;
  historial: DocSoporte[];
  candidatas: { id: string; numero: number; numero_factura: string; fecha_factura: string; total: number }[];
  semana: { desde: string; hasta: string };
  numeracion: { existe: boolean; pruebas: boolean | null; demo: boolean };
  bloqueo: string | null;
};

const COLS = `d.id::text, d.tipo, d.prefijo || d.numero numero, case when d.estado = 'enviando' then 'pendiente' when d.estado = 'aceptado' and d.simulado then 'simulado' else d.estado end estado,
  d.simulado, d.cufe, to_char(d.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, d.total::float, d.compra_id is null and d.tipo = 'soporte' semanal,
  d.periodo_desde::text, d.periodo_hasta::text, d.concepto, d.motivo, d.ultimo_error, d.xml is not null xml,
  case when d.pdf_url ~ '^https://' then d.pdf_url end pdf,
  coalesce((select json_agg(json_build_object('id', c.id, 'numero', c.numero, 'numero_factura', c.numero_factura) order by c.numero)
    from soporte_compras s join compras c on c.id = s.compra_id where s.documento_id = coalesce(d.origen_id, d.id)), '[]') compras`;

/** Estado del documento soporte de una compra (para la ficha de la compra). null si la compra no es de la empresa. */
export async function estadoSoporte(c: Tx, empresa: string, compraId: string): Promise<EstadoSoporte | null> {
  const k = (await c.query(`select c.id, c.numero, c.estado, c.proveedor_id, p.nombre proveedor, p.nit proveedor_nit, p.obligado_facturar obligado,
      c.fecha_factura::text, c.total::float, date_trunc('week', c.fecha_factura::timestamp)::date::text desde, (date_trunc('week', c.fecha_factura::timestamp)::date + 6)::text hasta
    from compras c join proveedores p on p.id = c.proveedor_id where c.id = $1 and c.empresa_id = $2`, [compraId, empresa])).rows[0];
  if (!k) return null;
  const { desde, hasta, ...compra } = k;
  const res = (await c.query(`select r.pruebas, e.demo from empresas e left join resoluciones_dian r on r.empresa_id = e.id and r.tipo = 'soporte' and r.activa where e.id = $1`, [empresa])).rows[0];
  const numeracion = { existe: res?.pruebas !== null && res?.pruebas !== undefined, pruebas: res?.pruebas ?? null, demo: !!res?.demo };
  if (compra.obligado) return { compra, vigente: null, historial: [], candidatas: [], semana: { desde, hasta }, numeracion, bloqueo: null };
  // Todos los documentos soporte en que ha estado la compra (el vigente primero).
  const docs: (DocSoporte & { liberada: boolean })[] = (await c.query(`select ${COLS}, s.liberada is not null liberada
      from soporte_compras s join documentos_dian d on d.id = s.documento_id where s.compra_id = $1 and d.empresa_id = $2 order by s.liberada nulls first, d.creado desc`, [compraId, empresa])).rows;
  const v = docs.find((x) => !x.liberada) ?? null;
  let vigente: EstadoSoporte["vigente"] = null;
  if (v) {
    const ajustes: DocSoporte[] = (await c.query(`select ${COLS} from documentos_dian d where d.origen_id = $1 and d.tipo = 'ajuste_soporte' order by d.creado`, [v.id])).rows;
    const tarifas = (await c.query(`select distinct iva_pct::float t from documento_lineas where documento_id = $1 order by 1`, [v.id])).rows.map((r) => r.t as number);
    const disponible = Math.round((v.total - ajustes.reduce((s, a) => s + a.total, 0)) * 100) / 100;
    vigente = { ...v, ajustes, disponible, anulado: ajustes.some((a) => a.concepto === "anulacion"), tarifas };
  }
  // Para el semanal: compras registradas del mismo proveedor en la misma semana que no están en un soporte vigente.
  const candidatas = (await c.query(`select c.id, c.numero, c.numero_factura, c.fecha_factura::text, c.total::float from compras c
      where c.empresa_id = $1 and c.proveedor_id = $2 and c.estado = 'registrada' and c.fecha_factura between $3::date and $4::date
        and not exists (select 1 from soporte_compras s where s.compra_id = c.id and s.liberada is null)
      order by c.fecha_factura, c.numero limit 200`, [empresa, compra.proveedor_id, desde, hasta])).rows;
  return { compra, vigente, historial: docs.filter((x) => x.liberada), candidatas, semana: { desde, hasta }, numeracion, bloqueo: await bloqueoEnvio(c, empresa, "soporte") };
}

/** Factura y sus líneas para la nota débito. */
export async function facturaParaNotaDebito(c: Tx, empresa: string, documentoId: string) {
  const f = (await c.query(`select d.id::text, d.prefijo || d.numero numero, d.estado, d.simulado, d.cufe, v.id::text venta_id, v.prefijo || v.numero venta, v.estado venta_estado,
      v.total::float, to_char(v.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, cl.nombre cliente,
      case when cl.id is null then null else cl.tipo_doc || ' ' || cl.numero_doc end cliente_doc
    from documentos_dian d join ventas v on v.id = d.venta_id left join clientes cl on cl.id = v.cliente_id
    where d.id = $1 and d.empresa_id = $2 and d.tipo = 'factura'`, [documentoId, empresa])).rows[0];
  if (!f) return null;
  const lineas = (await c.query(`select descripcion, sum(cantidad)::float cantidad, iva_pct::float, sum(base)::float base, sum(total)::float total
    from venta_lineas where venta_id = $1 group by descripcion, iva_pct, producto_id, presentacion order by min(id)`, [f.venta_id])).rows as
    { descripcion: string; cantidad: number; iva_pct: number; base: number; total: number }[];
  const notas = (await c.query(`select ${COLS} from documentos_dian d where d.origen_id = $1 and d.tipo = 'nota_debito' order by d.creado`, [documentoId])).rows as DocSoporte[];
  return { factura: f, lineas, notas, bloqueo: await bloqueoEnvio(c, empresa, "nota_debito") };
}
