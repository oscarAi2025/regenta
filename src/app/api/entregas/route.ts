import { z } from "zod";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { cajaElegida } from "@/lib/caja-elegida";
import { excel, pideExcel, rango, respuestaExcel } from "@/lib/reportes";
import { DESTINATARIOS, esDestinatario } from "@/lib/entregas";
import { COLUMNAS_ENTREGAS, consumo, lineasRango, listaEntregas, puedeEntregar } from "@/lib/entregas-datos";

// Entregas internas (modo droguería interna, sin DIAN). GET: las del rango con el consumo por servicio y por producto
// (JSON) o el detalle por lote (Excel). POST: registra una entrega; la base exige el modo interno, toma los lotes por
// vencimiento, pide la fórmula como la caja y numera EI-n.

const SIN_PERMISO = { error: "Las entregas las manejan la gerencia, la caja y la bodega" };
/** Antes de la migración 049 las funciones no existen: se responde claro en vez de un error interno. */
const noLista = (e: unknown) => (e as { code?: string }).code === "42883" || (e as { code?: string }).code === "42P01";
const NO_LISTO = { error: "Las entregas internas se están activando en tu Regenta: vuelve a intentarlo en unos minutos." };

export const GET = conSesion(async (s, req) => {
  if (!puedeEntregar(s.rol)) return json(SIN_PERMISO, 403);
  const u = new URL(req.url).searchParams;
  const r = rango(u.get("desde"), u.get("hasta"));
  try {
    if (pideExcel(u.get("formato"))) {
      const filas = await comoUsuario(s, (c) => lineasRango(c, s.empresa, r.desde, r.hasta));
      return respuestaExcel(excel("Entregas internas", filas.map((f) => ({ ...f, tipo: DESTINATARIOS[f.destinatario_tipo as keyof typeof DESTINATARIOS] ?? f.destinatario_tipo })), COLUMNAS_ENTREGAS),
        `regenta-entregas-${r.desde}-a-${r.hasta}.xlsx`);
    }
    const d = await comoUsuario(s, async (c) => ({ entregas: await listaEntregas(c, s.empresa, r.desde, r.hasta, u.get("q") ?? ""), consumo: await consumo(c, s.empresa, r.desde, r.hasta) }));
    return json({ ...r, ...d });
  } catch (e) {
    if (noLista(e)) return json(NO_LISTO, 409);
    throw e;
  }
});

const txt = (max: number) => z.string().trim().max(max).optional().default("");
const Entrega = z.object({
  idem_key: z.string().trim().min(8).max(80),
  destinatario_tipo: z.string().refine(esDestinatario, "Elige a quién se entrega"),
  destinatario: z.string().trim().min(3, "Escribe el nombre de quien recibe").max(120, "El nombre de quien recibe va hasta 120 caracteres"),
  documento: txt(30), servicio: txt(80), autoriza: z.string().trim().min(3, "Escribe quién autoriza la entrega").max(120), observacion: txt(300),
  lineas: z.array(z.object({ producto_id: z.string().uuid("Producto no válido"), presentacion: z.enum(["caja", "unidad"]), cantidad: z.number().int().min(1).max(100000) }))
    .min(1, "Agrega al menos un producto a la entrega").max(100, "Una entrega lleva hasta 100 productos"),
  formula: z.object({ verificada: z.boolean().optional(), paciente_tipo_doc: txt(5), paciente_doc: txt(30), paciente_nombre: txt(120), medico_nombre: txt(120),
    medico_registro: txt(40), formula_numero: txt(40), formula_fecha: txt(10) }).optional(),
});

export const POST = conSesion(async (s, req) => {
  if (!puedeEntregar(s.rol)) return json(SIN_PERMISO, 403);
  const p = Entrega.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos de la entrega" }, 400);
  const elegida = await cajaElegida();
  try {
    const r = await comoUsuario(s, async (c) => {
      const { sede_id } = await puestoDeTrabajo(c, s.empresa, elegida);
      return (await c.query(`select registrar_entrega($1) r`, [{ ...p.data, empresa_id: s.empresa, sede_id }])).rows[0].r as { entrega_id: string; numero: number; unidades: number; repetida: boolean };
    });
    return json({ ok: true, ...r });
  } catch (e) {
    if (noLista(e)) return json(NO_LISTO, 409);
    throw e;
  }
});
