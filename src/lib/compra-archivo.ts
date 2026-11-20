// Archivo de la factura del proveedor (ZIP/XML de la DIAN, PDF o foto): tipo real por su contenido y tope de tamaño.
// Lo usan «Cargar desde la factura» (nueva compra) y «Adjuntar la factura» de una compra ya registrada.

export const MAX_ARCHIVO = 12 * 1024 * 1024;

/** Tipo por los primeros bytes (no por el nombre ni por lo que diga el navegador). null = no es un archivo de factura. */
export function tipoArchivo(b: Uint8Array): string | null {
  if (b[0] === 0x50 && b[1] === 0x4b) return "application/zip";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  const ini = Buffer.from(b.subarray(0, 200)).toString("utf8").replace(/^﻿/, "").trimStart();
  return ini.startsWith("<") ? "application/xml" : null;
}

/** Se ve en el navegador sin descargar (PDF e imágenes); el ZIP y el XML se descargan. */
export const seVeEnPantalla = (tipo: string) => tipo === "application/pdf" || tipo.startsWith("image/");

export type ArchivoCompra = { id: string; nombre: string; tipo: string; tamano: number; creado: string; usuario: string | null };
