/** Última migración que necesita este código. Consola → Sistema la compara con la base: si falta, se ve antes de que
 *  algo falle. tests/version-db.test.mjs comprueba que coincide con el último archivo de db/migrations. */
export const MIGRACION_ESPERADA = "046_revision_independiente.sql";
