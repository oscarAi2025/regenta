import { z } from "zod";

// Mensajes de validación en español para todo el servidor (los esquemas con mensaje propio lo conservan).
// Se carga una sola vez al importar src/lib/api.ts o src/lib/admin.ts, que usan todas las rutas.
const n = (v: number | bigint) => Number(v).toLocaleString("es-CO");
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" || issue.received === "null" ? "Falta un dato obligatorio" : "Hay un dato con formato no válido" };
    case z.ZodIssueCode.too_big:
      return { message: issue.type === "string" ? `Máximo ${n(issue.maximum)} caracteres` : issue.type === "array" ? `Máximo ${n(issue.maximum)} elementos` : `El valor no puede ser mayor que ${n(issue.maximum)}` };
    case z.ZodIssueCode.too_small:
      return { message: issue.type === "string" ? (Number(issue.minimum) <= 1 ? "Falta un dato obligatorio" : `Mínimo ${n(issue.minimum)} caracteres`) : issue.type === "array" ? "Falta al menos un elemento" : `El valor debe ser al menos ${n(issue.minimum)}` };
    case z.ZodIssueCode.invalid_string:
      return { message: issue.validation === "email" ? "Correo no válido" : issue.validation === "uuid" ? "Identificador no válido" : "Texto con formato no válido" };
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union:
      return { message: "Opción no válida" };
    case z.ZodIssueCode.not_multiple_of:
      return { message: "El valor no es válido" };
    case z.ZodIssueCode.invalid_date:
      return { message: "Fecha no válida" };
    default:
      return { message: ctx.defaultError === "Required" ? "Falta un dato obligatorio" : "Revisa los datos" };
  }
});

export {};
