import { z } from "zod";

// Los primeros bytes dicen qué es el archivo: el logo tiene que ser de verdad la imagen que dice ser.
function esImagen(dataUrl: string): boolean {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return false;
  const b = Buffer.from(m[2].slice(0, 64), "base64");
  if (m[1] === "png") return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (m[1] === "jpeg") return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
}

/** Logo de la factura: PNG, JPEG o WebP en base64, ya reducido por la pantalla (máx. ~300 KB). Nunca SVG (puede llevar código). */
export const LogoCuerpo = z.object({
  logo: z.string().max(400000, "El logo pesa demasiado: usa una imagen más pequeña").regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "El logo debe ser una imagen PNG, JPG o WebP")
    .refine(esImagen, "El archivo no es una imagen PNG, JPG o WebP válida").nullable(),
});
