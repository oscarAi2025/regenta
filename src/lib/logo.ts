import { z } from "zod";

/** Logo de la factura: PNG, JPEG o WebP en base64, ya reducido por la pantalla (máx. ~300 KB). Nunca SVG (puede llevar código). */
export const LogoCuerpo = z.object({
  logo: z.string().max(400000, "El logo pesa demasiado: usa una imagen más pequeña").regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "El logo debe ser una imagen PNG, JPG o WebP").nullable(),
});
