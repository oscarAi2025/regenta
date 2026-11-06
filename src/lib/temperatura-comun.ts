// Planilla de temperatura y humedad: textos y cálculos compartidos entre el servidor y el navegador.

export const AREAS = { general: "Almacenamiento general", frio: "Cadena de frío (nevera)" } as const;
export const AREA_CORTA = { general: "General", frio: "Nevera" } as const;
export const JORNADAS = { manana: "Mañana", tarde: "Tarde" } as const;
export type Area = keyof typeof AREAS;
export type Jornada = keyof typeof JORNADAS;

export type Rango = { area: Area; temp_min: number; temp_max: number; hum_min: number | null; hum_max: number | null; personalizado: boolean };
export type Registro = {
  id: string; fecha: string; jornada: Jornada; area: Area; temperatura: number; humedad: number | null;
  temp_min: number; temp_max: number; hum_min: number | null; hum_max: number | null; fuera_rango: boolean;
  accion: string | null; observacion: string | null; responsable: string; anula_id: string | null; motivo: string | null;
  hora: string; creado: string; vigente: boolean;
};

/** Número con coma decimal y una cifra («22,5»). */
// Formatos hechos a mano (no toLocaleString): el servidor y el navegador deben escribir exactamente lo mismo.
export const dec = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? "—" : Number(n).toFixed(1).replace(".", ",").replace(/^-0,0$/, "0,0"));
export const rangoTexto = (min: number | null, max: number | null, u: string) => (min === null || max === null ? "sin control" : `${dec(min)} a ${dec(max)} ${u}`);
export const nombreCorto = (n: string) => n.split(" (")[0];

/** Qué está fuera del rango (vacío si todo está dentro). */
export function fueraDeRango(r: Pick<Rango, "temp_min" | "temp_max" | "hum_min" | "hum_max">, temperatura: number | null, humedad: number | null) {
  const f: string[] = [];
  if (temperatura !== null && (temperatura < r.temp_min || temperatura > r.temp_max)) f.push(`temperatura ${dec(temperatura)} °C (rango ${rangoTexto(r.temp_min, r.temp_max, "°C")})`);
  if (humedad !== null && r.hum_min !== null && r.hum_max !== null && (humedad < r.hum_min || humedad > r.hum_max)) f.push(`humedad ${dec(humedad)} % (rango ${rangoTexto(r.hum_min, r.hum_max, "%")})`);
  return f;
}

/** Días del mes «YYYY-MM» como «YYYY-MM-DD». */
export function diasDelMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);
}

export type Celda = { estado: "registrado" | "falta" | "hoy" | "futuro" | "antes"; vigente?: Registro; historial: Registro[] };

/** Estado de cada jornada del mes para un área. «falta» = día pasado sin registro desde que la droguería empezó la planilla
 *  de esa área (antes de su primer registro no se cuenta). */
export function celdas(mes: string, area: Area, registros: Registro[], inicio: string | null, hoy: string) {
  const out: Record<string, Record<Jornada, Celda>> = {};
  for (const dia of diasDelMes(mes)) {
    out[dia] = {} as Record<Jornada, Celda>;
    for (const j of Object.keys(JORNADAS) as Jornada[]) {
      const historial = registros.filter((r) => r.fecha === dia && r.jornada === j && r.area === area);
      const vigente = historial.find((r) => r.vigente);
      const estado = vigente ? "registrado" : dia > hoy ? "futuro" : dia === hoy ? "hoy" : inicio && dia >= inicio ? "falta" : "antes";
      out[dia][j] = { estado, vigente, historial };
    }
  }
  return out;
}

const SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const SEMANA_LARGA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const dow = (f: string) => new Date(f + "T12:00:00Z").getUTCDay();
/** «jue 6» */
export const diaCorto = (f: string) => `${SEMANA[dow(f)]} ${Number(f.slice(8, 10))}`;
/** «jueves 6 de noviembre» */
export const diaLargo = (f: string) => `${SEMANA_LARGA[dow(f)]} ${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7)) - 1]}`;
/** «noviembre de 2026» */
export const mesLargo = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
/** Mes anterior o siguiente de «YYYY-MM». */
export const otroMes = (mes: string, n: number) => { const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
