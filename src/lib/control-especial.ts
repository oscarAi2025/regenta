// Venta con fórmula médica y control especial: reglas compartidas por la caja (navegador) y la API (servidor).
// La base de datos vuelve a comprobarlas en registrar_formulas_venta y no deja confirmar una venta sin su registro.
// Módulo puro: sin base de datos ni React.

export const TIPOS_DOC_PACIENTE = [
  ["CC", "Cédula de ciudadanía"], ["TI", "Tarjeta de identidad"], ["RC", "Registro civil"], ["CE", "Cédula de extranjería"],
  ["PA", "Pasaporte"], ["PPT", "Permiso por protección temporal"], ["PEP", "Permiso especial de permanencia"],
] as const;
export type TipoDocPaciente = (typeof TIPOS_DOC_PACIENTE)[number][0];

export type DatosFormula = {
  verificada: boolean;
  paciente_tipo_doc: string; paciente_doc: string; paciente_nombre: string;
  medico_nombre: string; medico_registro: string; formula_numero: string; formula_fecha: string; // AAAA-MM-DD
};
export const FORMULA_VACIA: DatosFormula = {
  verificada: false, paciente_tipo_doc: "CC", paciente_doc: "", paciente_nombre: "", medico_nombre: "", medico_registro: "", formula_numero: "", formula_fecha: "",
};

/** Lo que pide la venta según sus productos y la configuración de la droguería. */
export type Exigencia = { control: string[]; formula: string[]; datos: boolean };
export type ConfigFormula = { vigencia_dias: number; exige_datos: boolean };
type ProdMarcas = { nombre: string; requiere_formula?: boolean | null; control_especial?: boolean | null };

export function exigencia(productos: ProdMarcas[], cfg: ConfigFormula): Exigencia {
  const unicos = (xs: string[]) => [...new Set(xs)];
  const control = unicos(productos.filter((p) => p.control_especial).map((p) => p.nombre));
  const formula = unicos(productos.filter((p) => !p.control_especial && p.requiere_formula).map((p) => p.nombre));
  return { control, formula, datos: control.length > 0 || (formula.length > 0 && cfg.exige_datos) };
}
export const pideFormula = (e: Exigencia) => e.control.length > 0 || e.formula.length > 0;

/** Fecha de hoy en Bogotá (AAAA-MM-DD). */
export const hoyBogota = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
export const restarDias = (f: string, n: number) => new Date(Date.parse(f + "T12:00:00Z") - n * 864e5).toISOString().slice(0, 10);
const fechaReal = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
export const limpiarDoc = (s: string) => s.replace(/[\s.\-]/g, "").toUpperCase();

/** Primer dato que falta o no sirve (mensaje para el droguista), o null si la fórmula está completa. */
export function errorFormula(d: Partial<DatosFormula> | null | undefined, e: Exigencia, cfg: ConfigFormula, hoy = hoyBogota()): string | null {
  if (!pideFormula(e)) return null;
  const f = { ...FORMULA_VACIA, ...(d ?? {}) };
  if (!e.datos) return f.verificada ? null : "Confirma que verificaste la fórmula médica";
  const t = (s: unknown) => String(s ?? "").trim();
  if (!TIPOS_DOC_PACIENTE.some(([k]) => k === t(f.paciente_tipo_doc).toUpperCase())) return "Elige el tipo de documento del paciente";
  if (!/^[0-9A-Z]{3,20}$/.test(limpiarDoc(t(f.paciente_doc)))) return "Escribe el número de documento del paciente (sin puntos)";
  if (t(f.paciente_nombre).length < 3 || t(f.paciente_nombre).length > 120) return "Escribe el nombre completo del paciente";
  if (t(f.medico_nombre).length < 3 || t(f.medico_nombre).length > 120) return "Escribe el nombre del médico que firma la fórmula";
  if (t(f.medico_registro).length < 2 || t(f.medico_registro).length > 40) return "Escribe el registro profesional del médico";
  if (!t(f.formula_numero) || t(f.formula_numero).length > 40) return "Escribe el número de la fórmula";
  if (!fechaReal(t(f.formula_fecha))) return "Escribe la fecha de la fórmula";
  if (f.formula_fecha > hoy) return "La fecha de la fórmula no puede ser posterior a hoy";
  if (e.control.length && f.formula_fecha < restarDias(hoy, cfg.vigencia_dias))
    return `La fórmula ya no está vigente: tiene más de ${cfg.vigencia_dias} días (plazo configurado por tu droguería)`;
  return null;
}
