import "server-only";
import { createHash } from "node:crypto";
import { sinRLS, type Tx } from "../db";
import { emisorMatias } from "./matias";
import { xmlSimulado } from "./xml";

// Cola de emisión DIAN. La venta nunca espera a la DIAN: queda «pendiente» y este proceso la envía con reintentos.
// El proveedor va detrás de una interfaz: hoy «simulado» (desarrollo y demo), mañana MATIAS (al tener cuenta y su
// documentación técnica). Cambiar de proveedor = escribir otro Emisor, nada más.

export type DocumentoParaEmitir = {
  id: string; tipo: "pos" | "factura" | "nota_credito" | "soporte" | "ajuste_soporte" | "nota_debito"; prefijo: string; numero: number; fecha: string;
  emisor: { nit: string; dv: string | null; razon_social: string; responsable_iva: boolean };
  cliente: { tipo_doc: string; numero_doc: string; dv: string | null; nombre: string; email: string | null } | null;
  lineas: { descripcion: string; codigo?: string | null; cantidad: number; precio: number; iva_pct: number; base: number; iva: number; total: number; descuento?: number /* pesos, IVA incluido */ }[];
  totales: { base: number; iva: number; total: number };
  pagos: { medio: string; valor: number }[];
  /** Forma de pago DIAN: contado (1) o crédito (2, con fecha de vencimiento). */
  forma_pago: { tipo: "contado" } | { tipo: "credito"; vence: string; plazo_dias: number };
  /** Número de la resolución DIAN de la numeración usada. */
  resolucion?: string | null;
  /** Documento original de una nota crédito (prefijo, número, fecha, CUFE/CUDE). */
  referencia?: { tipo: "pos" | "factura" | "soporte"; prefijo: string; numero: number; fecha: string; cufe: string | null } | null;
  /** Documento soporte y su nota de ajuste: el proveedor no obligado a facturar. */
  proveedor?: { tipo_doc: "NIT" | "CC"; numero_doc: string; dv: string | null; nombre: string; email: string | null; direccion: string | null; telefono: string | null } | null;
  /** Documento soporte semanal (o la fecha de la compra si es por operación). */
  periodo?: { desde: string; hasta: string } | null;
  /** Nota de ajuste o nota débito: concepto y motivo. */
  concepto?: "anulacion" | "correccion" | "mayor_valor" | null;
  motivo?: string | null;
  /** Punto de venta (POS electrónico): cajero, caja y dirección de la sede. */
  punto?: { cajero: string; caja: string; direccion: string | null } | null;
  /** UUID del cliente en la cuenta de casa de software de MATIAS (null = la propia cuenta). */
  matias_cliente?: string | null;
  /** Nota crédito por una devolución parcial (concepto DIAN 1) en vez de anulación total (concepto 2). */
  parcial?: boolean;
  /** La consola activó el envío real de documento soporte, nota de ajuste y nota débito para esta droguería. */
  envio_complementario?: boolean;
};
export type ResultadoEmision =
  | { ok: true; cufe: string; qr: string; simulado: boolean; respuesta: unknown; xml?: string | null; pdf?: string | null }
  | { ok: false; definitivo: boolean; error: string; respuesta?: unknown };
export interface Emisor { nombre: string; emitir(d: DocumentoParaEmitir): Promise<ResultadoEmision> }

/** Emisor simulado: devuelve un CUFE de ejemplo marcado como SIMULADO. Nunca se usa con resolución de producción. */
const simulado: Emisor = {
  nombre: "simulado",
  async emitir(d) {
    const cufe = createHash("sha384").update(`${d.emisor.nit}|${d.prefijo}${d.numero}|${d.fecha}|${d.totales.total}`).digest("hex");
    return { ok: true, cufe, qr: `SIMULADO · ${d.prefijo}${d.numero} · ${cufe.slice(0, 16)}`, simulado: true, respuesta: { simulado: true }, xml: xmlSimulado(d, cufe) };
  },
};

/** La droguería de demostración emite siempre en simulado; las reales con el proveedor del servidor (REGENTA_DIAN). */
function emisor(demo = false): Emisor {
  const p = demo ? "simulado" : process.env.REGENTA_DIAN ?? "simulado";
  if (p === "simulado") return simulado;
  if (p === "matias") return emisorMatias();
  throw new Error(`Proveedor DIAN no disponible: ${p}`);
}

const ESPERA = [30, 120, 600, 1800, 7200]; // segundos entre reintentos
// Res. DIAN 165/2023, art. 37: lo generado sin poder transmitir se transmite en 48 horas. Sin respuesta en 48 h, el documento
// pasa a revisión manual (rechazado, con aviso al dueño); antes, a las 24 h, ya se le avisa (operacion.ts, avisarDemorados).
const PLAZO_HORAS = 48;
const PRESUPUESTO_MS = 20000; // la función del servidor tiene ~26 s: se deja de tomar documentos a los 20 s

/** Procesa hasta `max` documentos pendientes (o solo los de una venta). Devuelve el resumen.
 *  Un envío que quedó «enviando» más de 5 minutos se reintenta: el proveedor rechaza el mismo prefijo+número dos veces,
 *  así que el reintento no duplica la emisión. */
export async function procesarCola(max = 20, venta?: string, documento?: string) {
  const r = { enviados: 0, aceptados: 0, rechazados: 0, reintentos: 0 };
  const t0 = Date.now();
  for (let i = 0; i < max && Date.now() - t0 < PRESUPUESTO_MS; i++) {
    // Toma un documento y lo marca «enviando» (skip locked: varias instancias no toman el mismo).
    const doc = await sinRLS(async (c) => {
      const { rows } = await c.query(
        `update documentos_dian set estado = 'enviando', intentos = intentos + 1, actualizado = now()
         where id = (select id from documentos_dian
                     where ((estado = 'pendiente' and proximo_intento <= now())
                        or (estado = 'enviando' and actualizado < now() - interval '5 minutes'))  -- envío que se cayó a medias
                       and ($1::uuid is null or venta_id = $1) and ($3::uuid is null or id = $3)
                     order by creado limit 1 for update skip locked)
         returning id, intentos, coalesce(reenviado, creado) < now() - make_interval(hours => $2) vencido`, [venta ?? null, PLAZO_HORAS, documento ?? null]);
      return rows[0] as { id: string; intentos: number; vencido: boolean } | undefined;
    });
    if (!doc) break;
    const id = doc.id;
    r.enviados++;
    if (doc.vencido) { await guardar(id, { ok: false, definitivo: true, error: `Sin respuesta tras ${PLAZO_HORAS} horas (${doc.intentos} intentos): revisar y reenviar` }); r.rechazados++; continue; }
    const d = await armar(id);
    if (d.esperar) {
      await sinRLS((c) => c.query(`update documentos_dian set estado = 'pendiente', intentos = greatest(intentos - 1, 0), proximo_intento = now() + interval '1 minute', actualizado = now() where id = $1`, [id]));
      r.enviados--; continue;
    }
    if (d.cerrado) {
      if (d.anulado) await sinRLS((c) => c.query(`update documentos_dian set estado = 'anulado', ultimo_error = 'Venta anulada antes de emitirse', actualizado = now() where id = $1`, [id]));
      else await guardar(id, { ok: false, definitivo: true, error: "Documento sin venta asociada" });
      r.rechazados++; continue;
    }
    // La demo y las numeraciones de prueba (antes de la habilitación ante la DIAN) se emiten en simulado.
    const e = emisor(d.demo || d.resolucionPruebas === true);
    if (d.resolucionPruebas === false && e.nombre === "simulado") {
      await guardar(id, { ok: false, definitivo: true, error: "Resolución de producción con emisor simulado: configure MATIAS" });
      r.rechazados++; continue;
    }
    let res: ResultadoEmision;
    try { res = await e.emitir(d.documento); } catch (err) { res = { ok: false, definitivo: false, error: String((err as Error).message) }; }
    await guardar(id, res);
    if (res.ok) r.aceptados++; else if (res.definitivo) r.rechazados++; else r.reintentos++;
  }
  return r;
}

/** Número de resolución de la numeración que cubre un documento (tipo, prefijo, número). Las notas no tienen resolución
 *  propia ante la DIAN, pero el proveedor exige un resolution_number: llevan el del documento que corrigen. */
async function resolucionDe(c: Tx, empresa: string, tipo: string, prefijo: string, numero: number | string): Promise<string | null> {
  return (await c.query(`select numero_resolucion from resoluciones_dian where empresa_id = $1 and tipo = $2 and prefijo = $3 and $4::bigint between desde and hasta
    and numero_resolucion is not null order by activa desc limit 1`, [empresa, tipo, prefijo, numero])).rows[0]?.numero_resolucion ?? null;
}

async function armar(id: string): Promise<{ documento: DocumentoParaEmitir; resolucionPruebas: boolean | null; demo: boolean; cerrado?: false; esperar?: false } | { cerrado: true; anulado?: boolean; esperar?: false } | { esperar: true; cerrado?: false }> {
  return sinRLS(async (c) => {
    const tipo = (await c.query(`select tipo from documentos_dian where id = $1`, [id])).rows[0]?.tipo;
    if (tipo === "soporte" || tipo === "ajuste_soporte" || tipo === "nota_debito") return armarComplementario(c, id);
    const { rows: [d] } = await c.query(
      `select d.*, v.base, v.iva as iva_total, v.total, v.creado as fecha, v.cliente_id, v.estado as venta_estado, v.condicion, v.vence_pago::text, v.plazo_dias,
              e.nit, e.dv, e.razon_social, e.responsable_iva, e.demo,
              e.matias_cliente, s.direccion as sede_direccion, cj.nombre as caja_nombre,
              (select m.nombre from miembros m where m.empresa_id = v.empresa_id and m.user_id = v.usuario_id) as cajero,
              (select pruebas from resoluciones_dian r where r.empresa_id = d.empresa_id and r.tipo = d.tipo and r.prefijo = d.prefijo and d.numero between r.desde and r.hasta order by activa desc limit 1) as pruebas,
              (select numero_resolucion from resoluciones_dian r where r.empresa_id = d.empresa_id and r.tipo = d.tipo and r.prefijo = d.prefijo and d.numero between r.desde and r.hasta order by activa desc limit 1) as resolucion
       from documentos_dian d join ventas v on v.id = d.venta_id join empresas e on e.id = d.empresa_id
       join sedes s on s.id = v.sede_id join cajas cj on cj.id = v.caja_id where d.id = $1`, [id]);
    if (!d) return { cerrado: true as const };
    // Una venta anulada antes de emitirse no se envía. Excepción: si al anularla ya tenía nota crédito (su envío pudo quedar
    // validado en la DIAN), el original sale igual y después la nota que lo anula.
    if (d.venta_estado === 'anulada' && d.tipo !== 'nota_credito'
      && !(await c.query(`select 1 from documentos_dian where venta_id = $1 and tipo = 'nota_credito' and devolucion_id is null`, [d.venta_id])).rowCount)
      return { cerrado: true as const, anulado: true };
    // Nota crédito de una devolución parcial: solo lo devuelto (líneas, totales y reembolso de esa devolución).
    const dev = d.devolucion_id ? (await c.query(`select base::float, iva::float, total::float, medio from devoluciones where id = $1`, [d.devolucion_id])).rows[0] : null;
    const lineas = (await c.query(dev
      ? `select vl.descripcion, (select coalesce(p.ean, left(p.id::text, 8)) from productos p where p.id = vl.producto_id) codigo, sum(dl.cantidad)::float cantidad, vl.precio::float, vl.iva_pct::float, sum(dl.base)::float base, sum(dl.iva)::float iva, sum(dl.total)::float total, sum(dl.descuento)::float descuento
         from devolucion_lineas dl join venta_lineas vl on vl.id = dl.venta_linea_id where dl.devolucion_id = $1 group by vl.descripcion, vl.precio, vl.iva_pct, vl.producto_id, vl.presentacion order by min(dl.id)`
      : `select descripcion, (select coalesce(p.ean, left(p.id::text, 8)) from productos p where p.id = producto_id) codigo, sum(cantidad)::float cantidad, precio::float, iva_pct::float, sum(base)::float base, sum(iva)::float iva, sum(total)::float total, sum(descuento)::float descuento
         from venta_lineas where venta_id = $1 group by descripcion, precio, iva_pct, producto_id, presentacion order by min(id)`, [dev ? d.devolucion_id : d.venta_id])).rows;
    const pagos = dev ? [{ medio: dev.medio, valor: dev.total }] : (await c.query(`select medio, valor::float from pagos where venta_id = $1`, [d.venta_id])).rows;
    // Nota crédito: el documento original de la misma venta (su CUFE/CUDE va en la referencia).
    const ref = d.tipo === "nota_credito" ? (await c.query(
      `select o.tipo, o.prefijo, o.numero, o.cufe, v.creado as fecha from documentos_dian o join ventas v on v.id = o.venta_id
       where o.venta_id = $1 and o.tipo <> 'nota_credito'`, [d.venta_id])).rows[0] : null;
    // La nota crédito necesita el CUFE del original: si el original aún no está aceptado, espera (no gasta intentos).
    if (d.tipo === "nota_credito" && !ref?.cufe) return { esperar: true as const };
    if (ref && !d.resolucion) d.resolucion = await resolucionDe(c, d.empresa_id, ref.tipo, ref.prefijo, ref.numero);
    const cli = d.cliente_id ? (await c.query(`select tipo_doc, numero_doc, dv, nombre, email from clientes where id = $1`, [d.cliente_id])).rows[0] : null;
    return {
      resolucionPruebas: d.pruebas, demo: !!d.demo,
      documento: {
        id, tipo: d.tipo, prefijo: d.prefijo, numero: Number(d.numero), fecha: new Date(d.tipo === "nota_credito" ? d.creado : d.fecha).toISOString(), // la nota lleva su propia fecha
        emisor: { nit: d.nit, dv: d.dv, razon_social: d.razon_social, responsable_iva: d.responsable_iva },
        cliente: cli, lineas, pagos,
        forma_pago: d.condicion === "credito" ? { tipo: "credito", vence: d.vence_pago, plazo_dias: d.plazo_dias } : { tipo: "contado" },
        totales: dev ? { base: dev.base, iva: dev.iva, total: dev.total } : { base: Number(d.base), iva: Number(d.iva_total), total: Number(d.total) },
        parcial: !!dev,
        resolucion: d.resolucion, matias_cliente: d.matias_cliente,
        punto: { cajero: d.cajero ?? "Caja", caja: d.caja_nombre, direccion: d.sede_direccion },
        referencia: ref ? { tipo: ref.tipo, prefijo: ref.prefijo, numero: Number(ref.numero), fecha: new Date(ref.fecha).toISOString(), cufe: ref.cufe } : null,
      },
    };
  });
}

async function guardar(id: string, res: ResultadoEmision) {
  await sinRLS(async (c) => {
    if (res.ok) {
      await c.query(`update documentos_dian set estado = 'aceptado', cufe = $2, qr = $3, simulado = $4, respuesta = $5, ultimo_error = null, actualizado = now(),
          xml = coalesce($6, xml), pdf_url = coalesce($7, pdf_url) where id = $1`,
        [id, res.cufe, res.qr, res.simulado, JSON.stringify(res.respuesta ?? null), res.xml ?? null, res.pdf ?? null]);
    } else if (res.definitivo) {
      await c.query(`update documentos_dian set estado = 'rechazado', ultimo_error = $2, respuesta = $3, actualizado = now() where id = $1`, [id, res.error, JSON.stringify(res.respuesta ?? null)]);
    } else {
      // Espera creciente según el número de intentos ya hechos.
      await c.query(`update documentos_dian set estado = 'pendiente', ultimo_error = $2,
        proximo_intento = now() + make_interval(secs => ($3::int[])[least(intentos, $4)]), actualizado = now() where id = $1`,
        [id, res.error, ESPERA, ESPERA.length]);
    }
  });
}

type Armado = Awaited<ReturnType<typeof armar>>;

/** Documento soporte, nota de ajuste y nota débito: sus líneas y totales son propios (documento_lineas), no de una venta. */
async function armarComplementario(c: Tx, id: string): Promise<Armado> {
  const { rows: [d] } = await c.query(
    `select d.*, d.creado as fecha, d.periodo_desde::text pdesde, d.periodo_hasta::text phasta,
            e.nit, e.dv, e.razon_social, e.responsable_iva, e.demo, e.matias_cliente, e.dian_complementario,
            pr.nombre pr_nombre, pr.nit pr_nit, pr.dv pr_dv, pr.email pr_email, pr.direccion pr_direccion, pr.telefono pr_telefono,
            o.tipo o_tipo, o.prefijo o_prefijo, o.numero o_numero, o.cufe o_cufe, coalesce(ov.creado, o.creado) o_fecha, ov.cliente_id,
            (select pruebas from resoluciones_dian r where r.empresa_id = d.empresa_id and r.tipo = d.tipo and r.prefijo = d.prefijo and d.numero between r.desde and r.hasta order by activa desc limit 1) as pruebas,
            (select numero_resolucion from resoluciones_dian r where r.empresa_id = d.empresa_id and r.tipo = d.tipo and r.prefijo = d.prefijo and d.numero between r.desde and r.hasta order by activa desc limit 1) as resolucion
     from documentos_dian d join empresas e on e.id = d.empresa_id
     left join proveedores pr on pr.id = d.proveedor_id
     left join documentos_dian o on o.id = d.origen_id left join ventas ov on ov.id = o.venta_id
     where d.id = $1`, [id]);
  if (!d) return { cerrado: true as const };
  // La nota (de ajuste o débito) necesita el código del original: si aún no está aceptado, espera (no gasta intentos).
  if (d.tipo !== "soporte" && !d.o_cufe) return { esperar: true as const };
  if (d.tipo !== "soporte" && !d.resolucion) d.resolucion = await resolucionDe(c, d.empresa_id, d.o_tipo, d.o_prefijo, d.o_numero);
  const lineas = (await c.query(`select descripcion, codigo, cantidad::float, precio::float, iva_pct::float, base::float, iva::float, total::float
    from documento_lineas where documento_id = $1 order by id`, [id])).rows;
  const cli = d.tipo === "nota_debito" && d.cliente_id ? (await c.query(`select tipo_doc, numero_doc, dv, nombre, email from clientes where id = $1`, [d.cliente_id])).rows[0] : null;
  const total = Number(d.total);
  return {
    resolucionPruebas: d.pruebas, demo: !!d.demo,
    documento: {
      id, tipo: d.tipo, prefijo: d.prefijo, numero: Number(d.numero), fecha: new Date(d.fecha).toISOString(),
      emisor: { nit: d.nit, dv: d.dv, razon_social: d.razon_social, responsable_iva: d.responsable_iva },
      cliente: cli ?? null, lineas, pagos: [{ medio: "efectivo", valor: total }], forma_pago: { tipo: "contado" },
      totales: { base: Number(d.base), iva: Number(d.iva), total },
      resolucion: d.resolucion, matias_cliente: d.matias_cliente, punto: null,
      proveedor: d.proveedor_id ? { tipo_doc: d.pr_dv ? "NIT" : "CC", numero_doc: d.pr_nit ?? "", dv: d.pr_dv, nombre: d.pr_nombre, email: d.pr_email,
        direccion: d.pr_direccion, telefono: d.pr_telefono } : null,
      periodo: d.pdesde ? { desde: d.pdesde, hasta: d.phasta } : null,
      concepto: d.concepto, motivo: d.motivo, envio_complementario: !!d.dian_complementario,
      referencia: d.origen_id ? { tipo: d.o_tipo, prefijo: d.o_prefijo, numero: Number(d.o_numero), fecha: new Date(d.o_fecha).toISOString(), cufe: d.o_cufe } : null,
    },
  };
}
