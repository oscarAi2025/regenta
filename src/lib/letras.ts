// Valor en letras para la factura (pesos colombianos). Hasta 999.999.999.999.
const U = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
  "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
  "veintisiete", "veintiocho", "veintinueve"];
const D = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const C = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function hasta999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100), r = n % 100;
  const resto = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " y " + U[r % 10] : "");
  return [C[c], resto].filter(Boolean).join(" ");
}

/** 1234567 → "un millón doscientos treinta y cuatro mil quinientos sesenta y siete pesos m/cte". */
export function pesosEnLetras(valor: number): string {
  let n = Math.round(Math.abs(valor));
  if (n === 0) return "Cero pesos m/cte";
  if (n === 1) return "Un peso m/cte";
  const millardos = Math.floor(n / 1e9); n %= 1e9;
  const millones = Math.floor(n / 1e6); n %= 1e6;
  const miles = Math.floor(n / 1e3); const unidades = n % 1e3;
  const partes: string[] = [];
  const millonesTotal = millardos * 1000 + millones;
  if (millonesTotal) {
    const mm = millardos ? (millardos === 1 ? "mil" : hasta999(millardos) + " mil") + (millones ? " " + hasta999(millones) : "") : hasta999(millones);
    partes.push(millonesTotal === 1 ? "un millón" : mm + " millones");
  }
  if (miles) partes.push(miles === 1 ? "mil" : hasta999(miles) + " mil");
  if (unidades) partes.push(hasta999(unidades));
  // «un millón de pesos», «dos millones de pesos»: con «de» cuando no hay miles ni unidades.
  const de = millonesTotal && !miles && !unidades ? " de" : "";
  const t = partes.join(" ") + de + " pesos m/cte";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
