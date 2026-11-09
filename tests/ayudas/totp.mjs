// Verificación en dos pasos de la consola en las pruebas: clave conocida (scripts/crear-superadmin.mjs con
// REGENTA_TOTP_PRUEBA) y el código de 6 cifras del momento, calculado como lo hace la app del teléfono (RFC 6238).
import { createHmac } from "node:crypto";
export const TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function bytes(s) { let bits = 0, v = 0; const o = []; for (const ch of s.replace(/\s/g, "").toUpperCase()) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); }
export function codigoTotp(secreto = TOTP, paso = Math.floor(Date.now() / 30000)) {
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", bytes(secreto)).update(m).digest(); const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
/** Un código no se acepta dos veces: antes de cada entrada se olvida el último usado (la prueba entra varias veces seguidas). */
export const olvidarUltimo = (pool, email) => pool.query(`update cuentas set totp_ultimo = null where lower(email) = lower($1)`, [email]);
