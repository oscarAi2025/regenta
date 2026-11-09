import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Verificación en dos pasos de la consola (TOTP, RFC 6238): el código de 6 cifras que cambia cada 30 s en Google
// Authenticator, Microsoft Authenticator, 1Password… El secreto se guarda cifrado (AES-256-GCM) con una llave
// derivada de REGENTA_SESSION_SECRET: quien lea la base no puede generar códigos.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(b: Buffer): string {
  let bits = 0, v = 0, s = "";
  for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { s += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) s += B32[(v << (5 - bits)) & 31];
  return s;
}
function desdeBase32(s: string): Buffer {
  const t = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, v = 0; const out: number[] = [];
  for (const ch of t) { const i = B32.indexOf(ch); if (i < 0) throw new Error("clave no válida"); v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

/** Código de 6 cifras del paso `paso` (cada 30 s desde 1970). */
export function codigoTotp(secreto: string, paso: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", desdeBase32(secreto)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
export const pasoActual = (ms = Date.now()) => Math.floor(ms / 30_000);

/** Paso que coincide con el código (se acepta ±30 s de desfase del reloj del teléfono), o null. `ultimo`: el paso del
 *  último código usado, que no se acepta otra vez (un código visto por encima del hombro no sirve dos veces). */
export function verificarTotp(secreto: string, codigo: string, ultimo: number | null): number | null {
  const c = codigo.replace(/\D/g, "");
  if (c.length !== 6) return null;
  const ahora = pasoActual();
  for (const p of [ahora, ahora - 1, ahora + 1]) {
    if (ultimo !== null && p <= ultimo) continue;
    if (timingSafeEqual(Buffer.from(codigoTotp(secreto, p)), Buffer.from(c))) return p;
  }
  return null;
}

export const nuevoSecretoTotp = () => base32(randomBytes(20));

const llave = () => {
  const s = process.env.REGENTA_SESSION_SECRET ?? (process.env.NODE_ENV !== "production" ? "solo-desarrollo-cambiar-en-produccion-0123456789" : "");
  if (s.length < 32) throw new Error("Falta REGENTA_SESSION_SECRET (mínimo 32 caracteres)");
  return createHash("sha256").update("totp:" + s).digest();
};
export function cifrar(texto: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", llave(), iv);
  const d = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), d].map((b) => b.toString("base64")).join(".");
}
export function descifrar(guardado: string): string {
  const [iv, tag, d] = guardado.split(".").map((x) => Buffer.from(x, "base64"));
  const c = createDecipheriv("aes-256-gcm", llave(), iv); c.setAuthTag(tag);
  return Buffer.concat([c.update(d), c.final()]).toString("utf8");
}
