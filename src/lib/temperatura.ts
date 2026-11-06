import "server-only";
import type { Tx } from "./db";
import type { Rol } from "./sesion";
import type { Area, Rango, Registro } from "./temperatura-comun";

// Planilla de temperatura y humedad (migración 029): datos de un mes de una sede, comunes a la pantalla, el informe
// imprimible y la exportación CSV.

/** Registran la planilla: dueño, administrador y bodega. Cambian los rangos: dueño y administrador. */
export const puedeTemperatura = (r: Rol) => r === "dueno" || r === "admin" || r === "bodeguero";
export const puedeRangos = (r: Rol) => r === "dueno" || r === "admin";

export const hoyBogota = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
/** Jornada que toca ahora en Bogotá: mañana hasta las 11:59, tarde desde las 12:00. */
export const jornadaActual = () => (Number(new Date().toLocaleString("en-US", { timeZone: "America/Bogota", hour: "numeric", hourCycle: "h23" })) < 12 ? "manana" : "tarde");

/** «YYYY-MM» pedido si es válido y no es futuro; si no, el mes en curso. */
export function mesValido(m?: string | null) {
  const actual = hoyBogota().slice(0, 7);
  return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m >= "2020-01" && m <= actual ? m : actual;
}

export async function datosMes(c: Tx, empresa: string, sede: string, mes: string) {
  const desde = `${mes}-01`;
  const registros = (await c.query(`
    select r.id::text, r.fecha::text, r.jornada, r.area, r.temperatura::float, r.humedad::float, r.temp_min::float, r.temp_max::float,
           r.hum_min::float, r.hum_max::float, r.fuera_rango, r.accion, r.observacion, r.responsable, r.anula_id::text, r.motivo,
           to_char(r.creado at time zone 'America/Bogota', 'HH24:MI') hora, to_char(r.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') creado,
           not exists (select 1 from temperatura_registros x where x.anula_id = r.id) vigente
    from temperatura_registros r
    where r.empresa_id = $1 and r.sede_id = $2 and r.fecha >= $3::date and r.fecha < ($3::date + interval '1 month')
    order by r.fecha, r.jornada = 'tarde', r.area, r.creado`, [empresa, sede, desde])).rows as Registro[];
  const rangos = (await c.query(`select area, temp_min::float, temp_max::float, hum_min::float, hum_max::float, personalizado from rangos_temperatura($1)`, [empresa])).rows as Rango[];
  // Desde cuándo lleva la droguería la planilla de cada área (antes de eso no hay jornadas «faltantes»).
  const inicio = Object.fromEntries((await c.query(`select area, min(fecha)::text inicio from temperatura_registros where empresa_id = $1 and sede_id = $2 group by area`, [empresa, sede])).rows
    .map((r) => [r.area, r.inicio])) as Partial<Record<Area, string>>;
  return { registros, rangos, inicio };
}
