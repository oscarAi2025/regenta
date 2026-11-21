/**
 * Qué NO es un cliente (21/11/2026): las pruebas del equipo ensuciaban el embudo (de 5 «pagos iniciados» en 30 días,
 * 4 eran pruebas de Oscar y el «aprobado» también). Un pago es de prueba si se marcó así en la consola, si el nombre de
 * la empresa dice «prueba» o si lo hizo un superadministrador con su correo. Las visitas del equipo se reconocen por la
 * cookie `regenta_interno` (la deja la consola o abrir cualquier página con ?interno=1) y por los orígenes de las
 * verificaciones automáticas.
 */
export const COOKIE_INTERNO = "regenta_interno";
export const ORIGENES_INTERNOS = ["verificacion-claude", "interno"];

/** Condición SQL: el pago (alias) es una prueba del equipo. */
export const pagoDePrueba = (p = "p") => `(coalesce(${p}.detalle ? 'prueba', false) or ${p}.empresa ~* '(^|[^a-z])prueba' or exists (select 1 from superadmins sa join cuentas sc on sc.id = sa.user_id where lower(sc.email) = lower(${p}.email)))`;

/** Condición SQL: el origen (columna) no es interno. */
export const origenReal = (col: string) => `coalesce(${col}, '') <> all (array['${ORIGENES_INTERNOS.join("','")}'])`;
