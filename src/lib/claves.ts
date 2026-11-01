import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Contraseñas con scrypt (N=2^15, r=8, p=1, 64 bytes) y sal aleatoria: «sal:hash» en hex.
// scripts/crear-superadmin.mjs usa exactamente los mismos parámetros.
const N = 32768, r = 8, p = 1, LARGO = 64, MAXMEM = 64 * 1024 * 1024;
const derivar = (clave: string, sal: Buffer) => new Promise<Buffer>((ok, mal) => scrypt(clave.normalize("NFKC"), sal, LARGO, { N, r, p, maxmem: MAXMEM }, (e, k) => (e ? mal(e) : ok(k))));

export async function cifrarClave(clave: string) {
  const sal = randomBytes(16);
  return `${sal.toString("hex")}:${(await derivar(clave, sal)).toString("hex")}`;
}

export async function claveCorrecta(clave: string, guardada: string | null) {
  // Siempre se deriva (aunque la cuenta no exista) para no delatar por el tiempo de respuesta qué correos existen.
  const [salHex, hashHex] = (guardada ?? "00000000000000000000000000000000:" + "00".repeat(LARGO)).split(":");
  const calculado = await derivar(clave, Buffer.from(salHex, "hex"));
  const esperado = Buffer.from(hashHex ?? "", "hex");
  return !!guardada && esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

/** Token de invitación: el enlace lleva el token; la base guarda solo su SHA-256. */
export const nuevoToken = () => randomBytes(24).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Reglas mínimas de contraseña. Devuelve el problema o null. */
export function problemaClave(clave: string) {
  if (clave.length < 10) return "La contraseña debe tener al menos 10 caracteres";
  if (clave.length > 200) return "La contraseña es demasiado larga";
  if (!/[a-zA-Z]/.test(clave) || !/\d/.test(clave)) return "Usa letras y números";
  return null;
}
