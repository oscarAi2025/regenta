// Crea (o cambia la contraseña de) una cuenta de superadministrador de Regenta. La contraseña se escribe en la
// terminal sin mostrarse y solo se guarda cifrada (scrypt, mismos parámetros que src/lib/claves.ts).
// Uso: DATABASE_URL=... node scripts/crear-superadmin.mjs correo@dominio.com "Nombre" [--reiniciar-dos-pasos]
// --reiniciar-dos-pasos: si se perdió el teléfono con la app de autenticación, borra la verificación en dos pasos; al
// entrar otra vez, la consola pide activarla con un código QR nuevo.
import pg from "pg";
import { createCipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import readline from "node:readline";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const reiniciar = process.argv.includes("--reiniciar-dos-pasos");
const [email, nombre = "Superadministrador"] = args;
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error("Uso: node scripts/crear-superadmin.mjs correo@dominio.com \"Nombre\""); process.exit(1); }

async function pedirClave() {
  if (process.env.REGENTA_CLAVE_PRUEBA) return process.env.REGENTA_CLAVE_PRUEBA; // solo para pruebas automáticas
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes("Contraseña")) process.stdout.write(s); };
  const leer = (t) => new Promise((ok) => rl.question(t, ok));
  const a = await leer("Contraseña (mín. 10, letras y números): "); process.stdout.write("\n");
  const b = await leer("Repítela: "); process.stdout.write("\n");
  rl.close();
  if (a !== b) throw new Error("No coinciden");
  return a;
}
const clave = await pedirClave();
if (clave.length < 10 || !/[a-zA-Z]/.test(clave) || !/\d/.test(clave)) { console.error("La contraseña debe tener al menos 10 caracteres, con letras y números"); process.exit(1); }
const sal = randomBytes(16);
const hash = await new Promise((ok, mal) => scrypt(clave.normalize("NFKC"), sal, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? mal(e) : ok(k))));

// En Supabase la conexión se verifica con su CA (DATABASE_CA = ruta al .crt descargado del panel, o el PEM).
const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const local = /localhost|127\.0\.0\.1|host=\/tmp/.test(url);
const ca = process.env.DATABASE_CA ? (existsSync(process.env.DATABASE_CA) ? readFileSync(process.env.DATABASE_CA, "utf8") : process.env.DATABASE_CA.replace(/\\n/g, "\n")) : undefined;
const db = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/g, ""), ...(local ? {} : { ssl: { ca, rejectUnauthorized: true } }) });
await db.connect();
const { rows } = await db.query(
  `insert into cuentas (email, nombre, clave_hash) values ($1, $2, $3)
   on conflict ((lower(email))) do update set clave_hash = excluded.clave_hash, nombre = excluded.nombre, activa = true, version_sesion = cuentas.version_sesion + 1 returning id`,
  [email.toLowerCase(), nombre, `${sal.toString("hex")}:${hash.toString("hex")}`]);
await db.query(`insert into superadmins (user_id, nombre) values ($1, $2) on conflict (user_id) do update set nombre = excluded.nombre`, [rows[0].id, nombre]);
if (reiniciar) await db.query(`update cuentas set totp_secreto = null, totp_pendiente = null, totp_ultimo = null where id = $1`, [rows[0].id]);
// Solo para pruebas automáticas: deja la verificación en dos pasos activa con una clave conocida (cifrada igual que
// src/lib/totp.ts), para que la prueba calcule los códigos.
if (process.env.REGENTA_TOTP_PRUEBA) {
  const llave = createHash("sha256").update("totp:" + (process.env.REGENTA_SESSION_SECRET ?? "solo-desarrollo-cambiar-en-produccion-0123456789")).digest();
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", llave, iv);
  const d = Buffer.concat([c.update(process.env.REGENTA_TOTP_PRUEBA, "utf8"), c.final()]);
  await db.query(`update cuentas set totp_secreto = $2, totp_pendiente = null, totp_ultimo = null where id = $1`, [rows[0].id, [iv, c.getAuthTag(), d].map((b) => b.toString("base64")).join(".")]);
}
await db.end();
console.log(`Superadministrador listo: ${email}. Entra en /admin con ese correo y contraseña.`);
