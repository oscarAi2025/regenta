// Crea (o cambia la contraseña de) una cuenta de superadministrador de Regenta. La contraseña se escribe en la
// terminal sin mostrarse y solo se guarda cifrada (scrypt, mismos parámetros que src/lib/claves.ts).
// Uso: DATABASE_URL=... node scripts/crear-superadmin.mjs correo@dominio.com "Nombre"
import pg from "pg";
import { randomBytes, scrypt } from "node:crypto";
import readline from "node:readline";

const [email, nombre = "Superadministrador"] = process.argv.slice(2);
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

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
await db.connect();
const { rows } = await db.query(
  `insert into cuentas (email, nombre, clave_hash) values ($1, $2, $3)
   on conflict ((lower(email))) do update set clave_hash = excluded.clave_hash, nombre = excluded.nombre, activa = true returning id`,
  [email.toLowerCase(), nombre, `${sal.toString("hex")}:${hash.toString("hex")}`]);
await db.query(`insert into superadmins (user_id, nombre) values ($1, $2) on conflict (user_id) do update set nombre = excluded.nombre`, [rows[0].id, nombre]);
await db.end();
console.log(`Superadministrador listo: ${email}. Entra en /admin con ese correo y contraseña.`);
