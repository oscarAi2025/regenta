// Control especial · informe mensual al Fondo Rotatorio de Estupefacientes (Anexo 13) y libro completo con saldo.
// Módulo puro (sin base de datos ni React): lo usan la API, las pantallas y las pruebas unitarias.
// Las cantidades vienen SIEMPRE de los movimientos de inventario (inmutables), en unidades mínimas de dispensación:
// el informe cuadra con el inventario de Regenta por construcción.
// Normas (verificadas 17/11/2026): Res. 1478/2006 art. 94 (informe dentro de los primeros 10 días calendario de cada mes,
// Anexo 13, también en ceros si no hubo movimiento), art. 91 (campos numéricos vacíos en 0 y de texto en «N/A»; texto en
// mayúscula; devoluciones y destrucciones van en entradas o salidas y se anotan aparte), art. 48 (registro manual o
// sistematizado; los errores se corrigen en el asiento siguiente, sin tachar) y art. 84 (recetario oficial). Listados:
// Res. 315/2020, anexo 3 (modificado por la Res. 116/2026). El formato exacto del Anexo 13 lo fija cada Fondo Rotatorio:
// por eso las columnas son una plantilla configurable.

// ───────────── Periodo y plazo ─────────────

/** "AAAA-MM" válido (mes real). */
export const mesValido = (m: string | null | undefined): m is string => !!m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** Primer y último día del mes "AAAA-MM". */
export function limitesMes(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** Mes anterior al de la fecha "AAAA-MM-DD" (o "AAAA-MM"). */
export function mesAnterior(fecha: string): string {
  const [a, m] = fecha.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-10" → "octubre de 2026". */
export const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

/** Plazo del informe del mes anterior: se presenta dentro de los primeros 10 días calendario del mes. */
export function plazo(hoy: string): { periodo: string; vence: string; dia: number; diasRestantes: number; vencido: boolean } {
  const dia = Number(hoy.slice(8, 10));
  return { periodo: mesAnterior(hoy), vence: `${hoy.slice(0, 7)}-10`, dia, diasRestantes: Math.max(0, 10 - dia), vencido: dia > 10 };
}

// ───────────── Libro completo: cada movimiento de inventario de un producto de control especial ─────────────

export type TipoAsiento = "inicial" | "entrada" | "anulacion_compra" | "dispensacion" | "salida_sin_formula" | "reintegro"
  | "devolucion_proveedor" | "ajuste_entrada" | "ajuste_salida" | "entrega_interna";

export const TIPO_ASIENTO: Record<TipoAsiento, string> = {
  inicial: "Inventario inicial", entrada: "Entrada por compra", anulacion_compra: "Anulación de compra",
  dispensacion: "Dispensación con fórmula", salida_sin_formula: "Venta sin fórmula registrada", reintegro: "Reintegro (anulación o devolución)",
  devolucion_proveedor: "Devolución al proveedor", ajuste_entrada: "Ajuste (entrada)", ajuste_salida: "Ajuste o baja (salida)",
  entrega_interna: "Entrega interna sin fórmula registrada",
};

/** Qué es, para el libro, un movimiento de inventario (tipo y signo tal como los guarda la base). */
export function clasificar(tipo: string, cantidad: number, conFormula: boolean): TipoAsiento {
  const entra = cantidad > 0;
  switch (tipo) {
    case "inicial": return entra ? "inicial" : "ajuste_salida";
    case "compra": return entra ? "entrada" : "anulacion_compra";
    case "venta": return entra ? "reintegro" : conFormula ? "dispensacion" : "salida_sin_formula";
    case "anulacion": return entra ? "reintegro" : "ajuste_salida";
    case "devolucion": return entra ? "reintegro" : "devolucion_proveedor";
    // Droguería interna (sin DIAN): la entrega con fórmula es una dispensación; su anulación, un reintegro.
    case "entrega": return entra ? "reintegro" : conFormula ? "dispensacion" : "entrega_interna";
    default: return entra ? "ajuste_entrada" : "ajuste_salida";
  }
}

export type MovimientoLibro = {
  id: string; fecha: string; producto_id: string; tipo: string; cantidad: number; con_formula: boolean;
  lote: string | null; vence: string | null; soporte: string | null; formula_numero: string | null; medico: string | null;
  paciente: string | null; usuario: string | null;
};
export type AsientoLibro = MovimientoLibro & { asiento: TipoAsiento; entrada: number; salida: number; saldo: number };

/** Asientos en orden con el saldo resultante después de cada uno, partiendo del saldo de cada producto al inicio. */
export function libroConSaldo(movs: MovimientoLibro[], inicial: Record<string, number>): AsientoLibro[] {
  const saldo: Record<string, number> = { ...inicial };
  return [...movs].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((m) => {
    saldo[m.producto_id] = (saldo[m.producto_id] ?? 0) + m.cantidad;
    return { ...m, asiento: clasificar(m.tipo, m.cantidad, m.con_formula), entrada: Math.max(0, m.cantidad), salida: Math.max(0, -m.cantidad), saldo: saldo[m.producto_id] };
  });
}

// ───────────── Consolidado del mes por medicamento ─────────────

export type FichaControl = {
  principio_activo: string | null; concentracion: string | null; forma_farmaceutica: string | null; cum: string | null; categoria: string | null;
};
/** Listados de medicamentos de control especial de la Res. 315/2020, anexo 3 (texto de la Res. 116/2026). */
export const CATEGORIAS = [
  "Medicamento de control especial de uso humano",
  "Medicamento de control especial monopolio del Estado",
  "Medicamento de control especial de uso veterinario",
] as const;
export type ProductoAnexo = {
  id: string; nombre: string; laboratorio: string | null; registro_sanitario: string | null; unidades_por_caja: number;
  control_especial: boolean; ficha: FichaControl | null;
};
export type Agregado = {
  inicial: number; entradas: number; salidas: number; dispensado: number; sin_formula: number; formulas: number;
  reintegros: number; devolucion_proveedor: number; bajas: number; // ya incluidos en entradas o salidas; se anotan aparte (art. 91)
};
export type FilaAnexo = ProductoAnexo & Agregado & { final: number; sin_movimiento: boolean; lotes: string };

/** Una fila por medicamento, también los que no se movieron (en ceros): saldo inicial + entradas − salidas = saldo final. */
export function consolidar(productos: ProductoAnexo[], agregados: Record<string, Partial<Agregado>>, lotes: Record<string, string> = {}): FilaAnexo[] {
  return productos.map((p) => {
    const a = agregados[p.id] ?? {};
    const x: Agregado = { inicial: a.inicial ?? 0, entradas: a.entradas ?? 0, salidas: a.salidas ?? 0, dispensado: a.dispensado ?? 0, sin_formula: a.sin_formula ?? 0,
      formulas: a.formulas ?? 0, reintegros: a.reintegros ?? 0, devolucion_proveedor: a.devolucion_proveedor ?? 0, bajas: a.bajas ?? 0 };
    return { ...p, ...x, final: x.inicial + x.entradas - x.salidas, sin_movimiento: x.entradas === 0 && x.salidas === 0, lotes: lotes[p.id] ?? "" };
  });
}

export const totales = (filas: FilaAnexo[]) => ({
  productos: filas.length, sin_movimiento: filas.filter((f) => f.sin_movimiento).length,
  inicial: filas.reduce((s, f) => s + f.inicial, 0), entradas: filas.reduce((s, f) => s + f.entradas, 0),
  salidas: filas.reduce((s, f) => s + f.salidas, 0), final: filas.reduce((s, f) => s + f.final, 0),
  formulas: filas.reduce((s, f) => s + f.formulas, 0),
});

// ───────────── Plantilla configurable de columnas ─────────────
// El formato exacto lo define cada Fondo Rotatorio: la droguería elige y nombra las columnas a partir de estos campos.

export type ContextoInforme = { periodo: string; departamento: string; droguería: string; nit: string; sede: string };

type Campo = { titulo: string; valor: (f: FilaAnexo, i: number, x: ContextoInforme) => string | number };
const na = (v: string | null | undefined) => (v && v.trim() ? v : "N/A");
export const CAMPOS: Record<string, Campo> = {
  consecutivo: { titulo: "N.º", valor: (_f, i) => i + 1 },
  medicamento: { titulo: "Medicamento (nombre comercial)", valor: (f) => f.nombre },
  principio_activo: { titulo: "Principio activo", valor: (f) => na(f.ficha?.principio_activo) },
  concentracion: { titulo: "Concentración", valor: (f) => na(f.ficha?.concentracion) },
  forma_farmaceutica: { titulo: "Forma farmacéutica", valor: (f) => na(f.ficha?.forma_farmaceutica) },
  presentacion: { titulo: "Presentación comercial", valor: (f) => (f.unidades_por_caja > 1 ? `Caja x ${f.unidades_por_caja}` : "Unidad") },
  cum: { titulo: "CUM", valor: (f) => na(f.ficha?.cum) },
  registro_sanitario: { titulo: "Registro sanitario", valor: (f) => na(f.registro_sanitario) },
  laboratorio: { titulo: "Laboratorio", valor: (f) => na(f.laboratorio) },
  categoria: { titulo: "Categoría del listado", valor: (f) => na(f.ficha?.categoria) },
  unidad: { titulo: "Unidad de medida", valor: () => "Unidad mínima de dispensación" },
  saldo_inicial: { titulo: "Saldo anterior", valor: (f) => f.inicial },
  entradas: { titulo: "Entradas", valor: (f) => f.entradas },
  salidas: { titulo: "Salidas", valor: (f) => f.salidas },
  saldo_final: { titulo: "Saldo final", valor: (f) => f.final },
  dispensado: { titulo: "Dispensado con fórmula", valor: (f) => f.dispensado },
  formulas: { titulo: "Fórmulas o recetarios del mes", valor: (f) => f.formulas },
  lotes: { titulo: "Lotes y vencimientos en existencia", valor: (f) => f.lotes || "N/A" },
  reintegros: { titulo: "Devoluciones de pacientes (incluidas en entradas)", valor: (f) => f.reintegros },
  devolucion_proveedor: { titulo: "Devoluciones al proveedor (incluidas en salidas)", valor: (f) => f.devolucion_proveedor },
  bajas: { titulo: "Bajas o destrucción (incluidas en salidas)", valor: (f) => f.bajas },
  observaciones: { titulo: "Observaciones", valor: (f) => observacion(f) },
  periodo: { titulo: "Periodo", valor: (_f, _i, x) => x.periodo },
  departamento: { titulo: "Departamento", valor: (_f, _i, x) => x.departamento || "N/A" },
  establecimiento: { titulo: "Establecimiento", valor: (_f, _i, x) => x.droguería },
  nit: { titulo: "NIT", valor: (_f, _i, x) => x.nit },
  sede: { titulo: "Sede", valor: (_f, _i, x) => x.sede || "N/A" },
};
export type ColumnaPlantilla = { campo: string; titulo: string };

/** Observación de la fila: sin movimiento, y las devoluciones y bajas que ya van dentro de entradas o salidas (art. 91). */
export function observacion(f: FilaAnexo): string {
  if (f.sin_movimiento) return "Sin movimiento en el periodo";
  const p: string[] = [];
  if (f.reintegros) p.push(`devoluciones de pacientes ${f.reintegros} und (en entradas)`);
  if (f.devolucion_proveedor) p.push(`devoluciones al proveedor ${f.devolucion_proveedor} und (en salidas)`);
  if (f.bajas) p.push(`bajas o destrucción ${f.bajas} und (en salidas)`);
  if (f.sin_formula) p.push(`${f.sin_formula} und vendidas sin fórmula registrada`);
  return p.length ? p.join("; ").replace(/^./, (c) => c.toUpperCase()) : "N/A";
}

/** Plantilla base de Regenta (punto de partida; cada droguería la ajusta al formato que le pide su Fondo Rotatorio). */
export const PLANTILLA_BASE: ColumnaPlantilla[] = ["consecutivo", "medicamento", "principio_activo", "concentracion", "forma_farmaceutica",
  "presentacion", "cum", "unidad", "saldo_inicial", "entradas", "salidas", "saldo_final", "observaciones"].map((campo) => ({ campo, titulo: CAMPOS[campo].titulo }));

/** Revisa una plantilla que llega de la pantalla o de la base: devuelve la plantilla limpia o el primer error. */
export function validarPlantilla(x: unknown): { ok: true; plantilla: ColumnaPlantilla[] } | { ok: false; error: string } {
  if (!Array.isArray(x) || x.length < 1 || x.length > 40) return { ok: false, error: "La plantilla debe tener entre 1 y 40 columnas" };
  const vistos = new Set<string>();
  const out: ColumnaPlantilla[] = [];
  for (const c of x) {
    const campo = typeof c?.campo === "string" ? c.campo : "";
    if (!CAMPOS[campo]) return { ok: false, error: `Campo desconocido en la plantilla: ${campo || "(vacío)"}` };
    if (vistos.has(campo)) return { ok: false, error: `El campo «${CAMPOS[campo].titulo}» está repetido` };
    vistos.add(campo);
    const titulo = (typeof c?.titulo === "string" ? c.titulo : "").replace(/\s+/g, " ").trim() || CAMPOS[campo].titulo;
    if (titulo.length > 80) return { ok: false, error: "Cada título de columna admite hasta 80 caracteres" };
    out.push({ campo, titulo });
  }
  return { ok: true, plantilla: out };
}

/** Filas del informe con las columnas de la plantilla (para Excel, pantalla e impresión). Con «mayusculas» (por defecto),
 *  el texto va en mayúscula fija como pide el art. 91; los números vacíos van en 0 y los textos vacíos en «N/A». */
export function aplicarPlantilla(filas: FilaAnexo[], plantilla: ColumnaPlantilla[], x: ContextoInforme, mayusculas = true) {
  const columnas: [string, string][] = plantilla.map((c) => [c.campo, mayusculas ? c.titulo.toLocaleUpperCase("es-CO") : c.titulo]);
  const limpio = (v: string | number) => (typeof v === "number" ? (Number.isFinite(v) ? v : 0) : (v.trim() ? (mayusculas ? v.toLocaleUpperCase("es-CO") : v) : "N/A"));
  const datos = filas.map((f, i) => Object.fromEntries(plantilla.map((c) => [c.campo, limpio(CAMPOS[c.campo].valor(f, i, x))])));
  return { columnas, datos };
}

// ───────────── Revisión antes de exportar ─────────────

export type Aviso = { nivel: "detiene" | "advierte"; texto: string };

/** Lo que hay que revisar antes de enviar el informe. «detiene» exige confirmar para exportar; «advierte» solo informa. */
export function revisarInforme(filas: FilaAnexo[], o: { mesAbierto: boolean; hayConfig: boolean }): Aviso[] {
  const a: Aviso[] = [];
  if (o.mesAbierto) a.push({ nivel: "detiene", texto: "El mes aún no termina: las cifras pueden cambiar. El informe se presenta con el mes cerrado." });
  const negativos = filas.filter((f) => f.final < 0 || f.inicial < 0);
  if (negativos.length) a.push({ nivel: "detiene", texto: `Saldo negativo en ${negativos.map((f) => f.nombre).join(", ")}: revisa entradas y ajustes en Inventario antes de enviar.` });
  const sinFormula = filas.filter((f) => f.sin_formula > 0);
  if (sinFormula.length) a.push({ nivel: "detiene", texto: `Salidas sin fórmula registrada: ${sinFormula.map((f) => `${f.nombre} (${f.sin_formula} und)`).join(", ")}. Suele pasar con ventas hechas antes de marcar el producto; explícalo en observaciones o corrígelo con un ajuste.` });
  const incompletas = filas.filter((f) => !f.ficha?.principio_activo || !f.ficha?.concentracion || !f.ficha?.forma_farmaceutica || !f.ficha?.cum);
  if (incompletas.length) a.push({ nivel: "detiene", texto: `Ficha incompleta (principio activo, concentración, forma farmacéutica o CUM) en: ${incompletas.map((f) => f.nombre).join(", ")}.` });
  if (!o.hayConfig) a.push({ nivel: "advierte", texto: "Falta configurar el departamento y el Fondo Rotatorio al que reportas." });
  if (filas.length === 0) a.push({ nivel: "advierte", texto: "No tienes productos de control especial: si no manejas ninguno, el informe va en ceros (N/A)." });
  return a;
}
export const detiene = (a: Aviso[]) => a.some((x) => x.nivel === "detiene");
