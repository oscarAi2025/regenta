import "server-only";
import type { Tx } from "./db";

// Ubicación del producto en la estantería o la bodega (migración 050). Antes de que la migración esté aplicada nada se
// rompe: las consultas leen null y no se guarda. Se comprueba una vez por proceso (cuando ya existe, no se vuelve a mirar),
// así la búsqueda de la caja usa la columna directa y no pierde velocidad.

let lista = false, revisado = 0;
async function hayColumna(c: Pick<Tx, "query">) {
  if (lista || Date.now() - revisado < 60_000) return lista;
  revisado = Date.now();
  lista = !!(await c.query(`select to_regprocedure('cambiar_ubicacion(uuid,text)') is not null listo`)).rows[0]?.listo;
  return lista;
}

/** Expresión SQL de la ubicación de un producto (alias de la tabla productos): la columna, o null sin la migración. */
export async function ubicacionSql(c: Pick<Tx, "query">, alias = "p") {
  return (await hayColumna(c)) ? `${alias}.ubicacion` : "null::text";
}

/** Guarda la ubicación (la base la normaliza, revisa el rol y la deja en la auditoría). Sin la migración, no hace nada. */
export async function guardarUbicacion(c: Pick<Tx, "query">, producto: string, ubicacion: string): Promise<string | null | undefined> {
  if (!(await hayColumna(c))) return undefined;
  return (await c.query(`select cambiar_ubicacion($1, $2) u`, [producto, ubicacion])).rows[0].u;
}
