import "server-only";
import { createHash } from "node:crypto";
import { sinRLS } from "../db";

// Cola de emisión DIAN. La venta nunca espera a la DIAN: queda «pendiente» y este proceso la envía con reintentos.
// El proveedor va detrás de una interfaz: hoy «simulado» (desarrollo y demo), mañana MATIAS (al tener cuenta y su
// documentación técnica). Cambiar de proveedor = escribir otro Emisor, nada más.

export type DocumentoParaEmitir = {
  id: string; tipo: "pos" | "factura" | "nota_credito"; prefijo: string; numero: number; fecha: string;
  emisor: { nit: string; dv: string | null; razon_social: string; responsable_iva: boolean };
  cliente: { tipo_doc: string; numero_doc: string; nombre: string; email: string | null } | null;
  lineas: { descripcion: string; cantidad: number; precio: number; iva_pct: number; base: number; iva: number; total: number }[];
  totales: { base: number; iva: number; total: number };
  pagos: { medio: string; valor: number }[];
};
export type ResultadoEmision =
  | { ok: true; cufe: string; qr: string; simulado: boolean; respuesta: unknown }
  | { ok: false; definitivo: boolean; error: string; respuesta?: unknown };
export interface Emisor { nombre: string; emitir(d: DocumentoParaEmitir): Promise<ResultadoEmision> }

/** Emisor simulado: devuelve un CUFE de ejemplo marcado como SIMULADO. Nunca se usa con resolución de producción. */
const simulado: Emisor = {
  nombre: "simulado",
  async emitir(d) {
    const cufe = createHash("sha384").update(`${d.emisor.nit}|${d.prefijo}${d.numero}|${d.fecha}|${d.totales.total}`).digest("hex");
    return { ok: true, cufe, qr: `SIMULADO · ${d.prefijo}${d.numero} · ${cufe.slice(0, 16)}`, simulado: true, respuesta: { simulado: true } };
  },
};

function emisor(): Emisor {
  const p = process.env.REGENTA_DIAN ?? "simulado";
  if (p === "simulado") return simulado;
  // MATIAS: pendiente de su documentación técnica (docs.matias-api.com) y de la cuenta de casa de software.
  throw new Error(`Proveedor DIAN no disponible: ${p}`);
}

const ESPERA = [30, 120, 600, 1800, 7200]; // segundos entre reintentos
const MAX_INTENTOS = 8; // después, rechazo definitivo para revisión manual

/** Procesa hasta `max` documentos pendientes (o solo los de una venta). Devuelve el resumen.
 *  Un envío que quedó «enviando» más de 5 minutos se reintenta: el proveedor rechaza el mismo prefijo+número dos veces,
 *  así que el reintento no duplica la emisión. */
export async function procesarCola(max = 20, venta?: string) {
  const e = emisor();
  const r = { enviados: 0, aceptados: 0, rechazados: 0, reintentos: 0 };
  for (let i = 0; i < max; i++) {
    // Toma un documento y lo marca «enviando» (skip locked: varias instancias no toman el mismo).
    const doc = await sinRLS(async (c) => {
      const { rows } = await c.query(
        `update documentos_dian set estado = 'enviando', intentos = intentos + 1, actualizado = now()
         where id = (select id from documentos_dian
                     where ((estado = 'pendiente' and proximo_intento <= now())
                        or (estado = 'enviando' and actualizado < now() - interval '5 minutes'))  -- envío que se cayó a medias
                       and ($1::uuid is null or venta_id = $1)
                     order by creado limit 1 for update skip locked)
         returning id, intentos`, [venta ?? null]);
      return rows[0] as { id: string; intentos: number } | undefined;
    });
    if (!doc) break;
    const id = doc.id;
    r.enviados++;
    if (doc.intentos > MAX_INTENTOS) { await guardar(id, { ok: false, definitivo: true, error: `Sin respuesta tras ${MAX_INTENTOS} intentos: revisar manualmente` }); r.rechazados++; continue; }
    const d = await armar(id);
    if (d.cerrado) {
      if (d.anulado) await sinRLS((c) => c.query(`update documentos_dian set estado = 'anulado', ultimo_error = 'Venta anulada antes de emitirse', actualizado = now() where id = $1`, [id]));
      else await guardar(id, { ok: false, definitivo: true, error: "Documento sin venta asociada" });
      r.rechazados++; continue;
    }
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

async function armar(id: string): Promise<{ documento: DocumentoParaEmitir; resolucionPruebas: boolean | null; cerrado?: false } | { cerrado: true; anulado?: boolean }> {
  return sinRLS(async (c) => {
    const { rows: [d] } = await c.query(
      `select d.*, v.base, v.iva as iva_total, v.total, v.creado as fecha, v.cliente_id, v.estado as venta_estado,
              e.nit, e.dv, e.razon_social, e.responsable_iva,
              (select pruebas from resoluciones_dian r where r.empresa_id = d.empresa_id and r.tipo = d.tipo and r.prefijo = d.prefijo order by activa desc limit 1) as pruebas
       from documentos_dian d join ventas v on v.id = d.venta_id join empresas e on e.id = d.empresa_id where d.id = $1`, [id]);
    if (!d) return { cerrado: true as const };
    // Una venta anulada antes de emitirse no se envía (su nota crédito sí: tipo nota_credito).
    if (d.venta_estado === 'anulada' && d.tipo !== 'nota_credito') return { cerrado: true as const, anulado: true };
    const lineas = (await c.query(
      `select descripcion, sum(cantidad)::float cantidad, precio::float, iva_pct::float, sum(base)::float base, sum(iva)::float iva, sum(total)::float total
       from venta_lineas where venta_id = $1 group by descripcion, precio, iva_pct, producto_id, presentacion order by min(id)`, [d.venta_id])).rows;
    const pagos = (await c.query(`select medio, valor::float from pagos where venta_id = $1`, [d.venta_id])).rows;
    const cli = d.cliente_id ? (await c.query(`select tipo_doc, numero_doc, nombre, email from clientes where id = $1`, [d.cliente_id])).rows[0] : null;
    return {
      resolucionPruebas: d.pruebas,
      documento: {
        id, tipo: d.tipo, prefijo: d.prefijo, numero: Number(d.numero), fecha: new Date(d.fecha).toISOString(),
        emisor: { nit: d.nit, dv: d.dv, razon_social: d.razon_social, responsable_iva: d.responsable_iva },
        cliente: cli, lineas, pagos,
        totales: { base: Number(d.base), iva: Number(d.iva_total), total: Number(d.total) },
      },
    };
  });
}

async function guardar(id: string, res: ResultadoEmision) {
  await sinRLS(async (c) => {
    if (res.ok) {
      await c.query(`update documentos_dian set estado = 'aceptado', cufe = $2, qr = $3, simulado = $4, respuesta = $5, ultimo_error = null, actualizado = now() where id = $1`,
        [id, res.cufe, res.qr, res.simulado, JSON.stringify(res.respuesta ?? null)]);
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
