import "server-only";
import { sinRLS } from "../db";

// Configuración DIAN en MATIAS desde la consola (casa de software): cuenta principal, certificado, software, set de
// pruebas y numeraciones. Documentación: docs.matias-api.com → Empresa, Certificado Digital, Software DIAN, Resoluciones.
// Cada llamada actúa sobre un cliente (?client_uuid=) o, si el UUID es el de la cuenta principal, sobre la propia cuenta
// (MATIAS no acepta el client_uuid de su propia empresa: no hay relación casa de software → cliente consigo misma).

export type CuentaPrincipal = { uuid: string; nit: string; nombre: string };
export type Certificado = { nombre: string; vence: string } | null;
export type Software = { id: number; tipo: number; produccion: boolean; identificacion: string; estado: string | null; detalle: string | null };
export type Resolucion = { tipo_documento: number; prefijo: string; numero: string; desde: number; hasta: number; vence: string | null; activa: boolean };

/** Tipos de software DIAN en MATIAS (type_id): 1 factura y notas, 3 documento soporte, 4 POS electrónico. */
export const TIPO_SOFTWARE: Record<number, string> = { 1: "Factura electrónica y notas", 2: "Nómina electrónica", 3: "Documento soporte", 4: "POS electrónico" };

const base = () => (process.env.MATIAS_URL ?? "https://sandbox-api.matias-api.com").replace(/\/$/, "") + "/api/ubl2.1";
export const matiasConfigurado = () => process.env.REGENTA_DIAN === "matias" && !!process.env.MATIAS_TOKEN;

export class ErrorMatias extends Error { constructor(m: string, public status = 502) { super(m); } }

type Json = Record<string, unknown> & { message?: unknown; success?: boolean; dataRecords?: { data?: unknown } & Record<string, unknown> };

async function llamar(metodo: "GET" | "POST" | "PUT", ruta: string, cuerpo?: unknown): Promise<Json> {
  const token = process.env.MATIAS_TOKEN;
  if (!token) throw new ErrorMatias("Falta MATIAS_TOKEN en el servidor", 503);
  const r = await fetch(base() + ruta, {
    method: metodo, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(20000), cache: "no-store",
  }).catch(() => null);
  if (!r) throw new ErrorMatias("MATIAS no respondió (tiempo agotado o sin conexión)");
  const j = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok || j.success === false) {
    const errores = j.errors && typeof j.errors === "object" ? Object.values(j.errors as Record<string, string[]>).flat().join(" · ") : "";
    const m = typeof j.message === "string" ? j.message : j.message && typeof j.message === "object" ? JSON.stringify(j.message) : "";
    throw new ErrorMatias(`MATIAS ${r.status}: ${errores || m || "sin detalle"}`.slice(0, 400), r.status === 401 || r.status === 403 ? 502 : r.status >= 500 ? 502 : 400);
  }
  return j;
}

/** El objeto útil de la respuesta: dataRecords.data, dataRecords o data (MATIAS no es uniforme entre endpoints). */
const datos = (j: Json): unknown => j.dataRecords?.data ?? j.dataRecords ?? (j as { data?: unknown }).data ?? null;
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));

let principal: { valor: CuentaPrincipal; hasta: number } | null = null;
/** La empresa de la cuenta principal (la de MATIAS_TOKEN). Se guarda 10 minutos en memoria. */
export async function cuentaPrincipal(): Promise<CuentaPrincipal> {
  if (principal && principal.hasta > Date.now()) return principal.valor;
  const d = datos(await llamar("GET", "/company")) as Record<string, unknown> | null;
  const valor = { uuid: texto(d?.uuid), nit: texto(d?.dni).replace(/\D/g, ""), nombre: texto(d?.company_name) };
  if (!valor.uuid || !valor.nit) throw new ErrorMatias("MATIAS no devolvió los datos de la cuenta principal");
  principal = { valor, hasta: Date.now() + 10 * 60_000 };
  return valor;
}

/** Parámetro de consulta para actuar sobre un cliente: vacío si es la cuenta principal. */
export async function consulta(cliente: string, extra = ""): Promise<string> {
  const p = await cuentaPrincipal();
  const partes = [cliente && cliente !== p.uuid ? `client_uuid=${encodeURIComponent(cliente)}` : "", extra].filter(Boolean);
  return partes.length ? `?${partes.join("&")}` : "";
}

export async function certificado(cliente: string): Promise<Certificado> {
  try {
    const d = datos(await llamar("GET", "/certificate" + (await consulta(cliente)))) as Record<string, unknown> | null;
    return d && (d.name || d.expiration_date) ? { nombre: texto(d.name), vence: texto(d.expiration_date) } : null;
  } catch (e) {
    if (e instanceof ErrorMatias && /no existe|no se encontr|not found|404/i.test(e.message)) return null;
    throw e;
  }
}

export async function softwares(cliente: string): Promise<Software[]> {
  const d = datos(await llamar("GET", "/software" + (await consulta(cliente, "page=1"))));
  const lista = (Array.isArray(d) ? d : []) as Record<string, unknown>[];
  return lista.map((s) => {
    const t = (s.test_process ?? null) as Record<string, unknown> | null;
    const msg = t?.error_message as { string?: unknown } | string | null | undefined;
    return {
      id: Number(s.id), tipo: Number(s.type_id), produccion: Number(s.environment_id) === 1, identificacion: texto(s.identification),
      estado: t ? texto(t.status_description ?? t.status) : texto(s.test_process_status) || null,
      detalle: msg ? texto(typeof msg === "object" ? msg.string : msg).slice(0, 400) || null : null,
    };
  });
}

export async function resoluciones(cliente: string): Promise<Resolucion[]> {
  const d = datos(await llamar("GET", "/resolutions" + (await consulta(cliente, "active=1&limit=50&page=1"))));
  const lista = (Array.isArray(d) ? d : []) as Record<string, unknown>[];
  return lista.map((r) => ({ tipo_documento: Number(r.type_document_id), prefijo: texto(r.prefix), numero: texto(r.resolution_number),
    desde: Number(r.range_from), hasta: Number(r.range_up), vence: texto(r.date_up) || null, activa: Number(r.active ?? 1) === 1 }));
}

/** Registra en MATIAS el software que la DIAN asignó al facturador (portal de habilitación, modo «Software propio»).
 *  MATIAS crea la cuenta con los software vacíos (sin ID): si ya hay uno de ese tipo se actualiza (PUT), si no se crea. */
export async function registrarSoftware(cliente: string, s: { tipo: 1 | 3 | 4; identificacion: string; pin: string; testsetid: string }) {
  const actual = (await softwares(cliente)).find((x) => x.tipo === s.tipo);
  if (actual?.produccion) throw new ErrorMatias("Ese software ya está en producción: no se cambia desde aquí", 409);
  const records = { environment_id: 2, type_id: s.tipo, integration_type: 1, identification: s.identificacion, pin: s.pin, testsetid: s.testsetid, initial_number: 1 };
  if (actual) {
    await llamar("PUT", `/software/${actual.id}` + (await consulta(cliente)), { records: JSON.stringify(records) });
    return actual.id;
  }
  const j = await llamar("POST", "/software" + (await consulta(cliente)), { records: JSON.stringify(records) });
  const rec = (j.record ?? datos(j)) as Record<string, unknown> | null;
  return Number(rec?.id) || null;
}

/** Inicia el set de pruebas de habilitación (corre en segundo plano en MATIAS; al terminar bien, el software pasa a producción). */
export async function iniciarPruebas(cliente: string, software: number) {
  const j = await llamar("POST", "/document/run-test" + (await consulta(cliente)), { software_id: software });
  return (texto(j.message) || "Set de pruebas iniciado").replace(/\.+$/, "");
}

/** Trae de la DIAN las numeraciones autorizadas al software (solo en producción) y las guarda en MATIAS. */
export async function sincronizarNumeraciones(cliente: string, tipo: 1 | 3 | 4) {
  const j = await llamar("GET", "/numbering-range" + (await consulta(cliente, `type_id=${tipo}&sync=1`)));
  const s = (j.sync ?? null) as { created?: number; updated?: number; failed?: number; total?: number; reason?: string } | null;
  if (!s) return "La DIAN respondió, pero no se sincronizó nada: el software de ese tipo aún no está en producción";
  if (s.reason) return `No se sincronizó: ${s.reason}`;
  return `Numeraciones de la DIAN: ${s.total ?? 0} (nuevas ${s.created ?? 0}, actualizadas ${s.updated ?? 0}, con error ${s.failed ?? 0})`;
}

/** Solo para pruebas: olvida la cuenta principal guardada en memoria. */
export const _olvidarPrincipal = () => { principal = null; };

export type ResolucionNota = { tipo_documento: 4 | 5 | 93 | 94; prefijo: string; numero: string; desde: number; hasta: number; vigente_desde: string; vence: string; nombre: string };

/** Las notas no tienen resolución propia ante la DIAN, pero MATIAS exige un resolution_number y busca la resolución
 *  configurada para ese tipo y prefijo: se registra con el número de la resolución del documento que corrigen
 *  (factura → 5/4, POS → 94/93). Crea solo las que faltan. Devuelve cuántas creó. */
export async function asegurarResolucionesNotas(cliente: string, notas: ResolucionNota[]): Promise<number> {
  if (!notas.length) return 0;
  const hay = await resoluciones(cliente);
  let creadas = 0;
  for (const n of notas) {
    if (hay.some((r) => r.tipo_documento === n.tipo_documento && r.prefijo === n.prefijo && r.numero === n.numero)) continue;
    const records = { type_document_id: n.tipo_documento, resolution_number: n.numero, prefix: n.prefijo, invoice_name: n.nombre,
      range_from: n.desde, range_up: n.hasta, date_from: n.vigente_desde, date_up: n.vence, initial_number: n.desde, active: 1 };
    try { await llamar("POST", "/resolutions" + (await consulta(cliente)), { records: JSON.stringify(records) }); creadas++; }
    catch (e) { if (!(e instanceof ErrorMatias && /ya existe/i.test(e.message))) throw e; }
  }
  return creadas;
}

/** Resoluciones que MATIAS necesita para las notas de producción del cliente: cada numeración de notas (crédito y débito)
 *  con el número de la resolución vigente del documento que corrigen (factura y, si tiene POS en producción, POS). */
export async function notasParaMatias(id: string): Promise<ResolucionNota[]> {
  const { rows } = await sinRLS((c) => c.query(`select n.tipo, n.prefijo, n.desde::float, n.hasta::float, o.tipo origen, o.numero_resolucion,
      coalesce(o.vigente_desde, current_date)::text desde_f, o.vigente_hasta::text hasta_f
    from resoluciones_dian n join resoluciones_dian o on o.empresa_id = n.empresa_id and o.activa and not o.pruebas and o.tipo in ('factura', 'pos')
      and o.numero_resolucion is not null and o.vigente_hasta is not null
    where n.empresa_id = $1 and n.activa and not n.pruebas and n.tipo in ('nota_credito', 'nota_debito')
      and (n.tipo = 'nota_credito' or o.tipo = 'factura')`, [id]));
  return rows.map((r) => ({
    tipo_documento: (r.origen === "pos" ? (r.tipo === "nota_credito" ? 94 : 93) : (r.tipo === "nota_credito" ? 5 : 4)) as ResolucionNota["tipo_documento"],
    prefijo: r.prefijo, numero: r.numero_resolucion, desde: r.desde, hasta: r.hasta, vigente_desde: r.desde_f, vence: r.hasta_f,
    nombre: r.tipo === "nota_credito" ? "NOTA CRÉDITO" : "NOTA DÉBITO",
  }));
}
