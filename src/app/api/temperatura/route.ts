import { z } from "zod";
import { cajaElegida } from "@/lib/caja-elegida";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { excel, respuestaExcel } from "@/lib/reportes";
import { datosMes, hoyBogota, mesValido, puedeRangos, puedeTemperatura } from "@/lib/temperatura";
import { AREAS, JORNADAS, dec } from "@/lib/temperatura-comun";

const texto = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`).nullish();
const Registro = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida").nullish(),
  jornada: z.enum(["manana", "tarde"]).nullish(),
  area: z.enum(["general", "frio"]).nullish(),
  temperatura: z.number({ required_error: "Escribe la temperatura", invalid_type_error: "Escribe la temperatura" }).min(-30, "Revisa la temperatura").max(60, "Revisa la temperatura"),
  humedad: z.number({ invalid_type_error: "Revisa la humedad" }).min(0, "La humedad va de 0 a 100 %").max(100, "La humedad va de 0 a 100 %").nullish(),
  accion: texto(500), observacion: texto(500),
  anula_id: z.string().uuid().nullish(),
  motivo: texto(300),
}).refine((r) => r.anula_id || (r.jornada && r.area), { message: "Elige la jornada y el área" });

const RangoArea = z.object({
  area: z.enum(["general", "frio"]),
  temp_min: z.number().min(-30).max(60), temp_max: z.number().min(-30).max(60),
  hum_min: z.number().min(0).max(100).nullable(), hum_max: z.number().min(0).max(100).nullable(),
});

/** Registra una jornada de la planilla (o corrige un registro: queda el anterior, anulado con su motivo). */
export const POST = conSesion(async (s, req) => {
  if (!puedeTemperatura(s.rol)) return json({ error: "Tu usuario no registra la planilla de temperatura" }, 403); // el permiso antes que los datos
  const p = Registro.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos incompletos" }, 400);
  const caja = await cajaElegida();
  const { registro, mes } = await comoUsuario(s, async (c) => {
    const { sede_id } = await puestoDeTrabajo(c, s.empresa, caja);
    const registro = (await c.query(`select registrar_temperatura($1) r`, [{ ...p.data, fecha: p.data.fecha ?? hoyBogota(), empresa_id: s.empresa, sede_id }])).rows[0].r;
    // La planilla del mes ya con el registro: la pantalla se actualiza con esto sin esperar a recargar los datos.
    const m = String(registro.fecha).slice(0, 7);
    return { registro, mes: { mes: m, ...(await datosMes(c, s.empresa, sede_id, m)) } };
  });
  return json({ registro, mes });
});

/** Cambia el rango de un área (dueño o administrador). */
export const PATCH = conSesion(async (s, req) => {
  if (!puedeRangos(s.rol)) return json({ error: "Solo el dueño o el administrador cambian los rangos" }, 403);
  const p = RangoArea.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos incompletos" }, 400);
  const d = p.data;
  await comoUsuario(s, (c) => c.query(`select configurar_rango_temperatura($1, $2, $3, $4, $5, $6)`, [s.empresa, d.area, d.temp_min, d.temp_max, d.hum_min, d.hum_max]));
  return json({ ok: true });
});

/** Exporta la planilla del mes (?mes=YYYY-MM) a Excel (.xlsx), con los registros anulados por corrección. */
export const GET = conSesion(async (s, req) => {
  if (!puedeTemperatura(s.rol)) return json({ error: "Tu usuario no ve la planilla de temperatura" }, 403);
  const mes = mesValido(new URL(req.url).searchParams.get("mes"));
  const caja = await cajaElegida();
  const { registros } = await comoUsuario(s, async (c) => datosMes(c, s.empresa, (await puestoDeTrabajo(c, s.empresa, caja)).sede_id, mes));
  const filas = registros.map((r) => ({
    ...r, jornada: JORNADAS[r.jornada], area: AREAS[r.area], rango_t: `${dec(r.temp_min)} a ${dec(r.temp_max)}`, rango_h: r.hum_min === null ? "Sin control" : `${dec(r.hum_min)} a ${dec(r.hum_max)}`,
    fuera: r.fuera_rango ? "Sí" : "No", estado: r.vigente ? "Vigente" : "Anulado por corrección", responsable: r.responsable.split(" (")[0],
  }));
  const libro = excel("Temperatura y humedad", filas, [["fecha", "Fecha"], ["jornada", "Jornada"], ["area", "Área"], ["temperatura", "Temperatura °C"], ["humedad", "Humedad relativa %"],
    ["rango_t", "Rango temperatura °C"], ["rango_h", "Rango humedad %"], ["fuera", "Fuera de rango"], ["accion", "Acción correctiva"], ["observacion", "Observación"],
    ["responsable", "Responsable"], ["creado", "Registrado"], ["estado", "Estado"], ["motivo", "Motivo de la corrección"]]);
  return respuestaExcel(libro, `regenta-temperatura-${mes}.xlsx`);
});
