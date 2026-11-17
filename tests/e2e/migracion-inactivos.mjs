// Migración desde Alegra: los artículos INACTIVOS que aún muestran existencias no entran a la caja salvo que se pida
// (auditoría 17/11/2026: 641 unidades de montelukast inexistentes llegaron así al inventario real). Datos sintéticos sobre
// la droguería VECINA: simular avisa y lista; aplicar por defecto los deja inactivos y en cero; «importar» los trae.
// Uso: servidor con la base sembrada → BASE=… DATABASE_URL=… REGENTA_SESSION_SECRET=… node tests/e2e/migracion-inactivos.mjs
import pg from "pg";
import { execFileSync } from "node:child_process";
import { codigoTotp, TOTP } from "../ayudas/totp.mjs";

const B = process.env.BASE ?? "http://localhost:4540";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const E = "10000000-0000-4000-8000-00000000000b"; // DROGUERÍA VECINA
const suf = Date.now().toString().slice(-7);
const IP = `10.79.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function llamar(ruta, cuerpo, cookie) {
  const r = await fetch(B + ruta, { method: "POST", redirect: "manual", headers: { origin: B, "x-real-ip": IP, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(cuerpo) });
  return { s: r.status, j: await r.json().catch(() => ({})), cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
}
const ADMIN = `admin${suf}@inactivos.test`;
execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN, "Admin Inactivos"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: "ConsolaInact2026", REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });
const adm = (await llamar("/api/acceso", { email: ADMIN, clave: "ConsolaInact2026", consola: true, codigo: codigoTotp() })).cookie;
ok(adm.startsWith("regenta_admin="), "la consola entra");
const mig = (extra) => llamar(`/api/admin/clientes/${E}/migracion`, { parte: "productos", reemplazar: false, filas, ...extra }, adm);

const filas = [
  { externo_id: `A${suf}`, nombre: `ACTIVO PRUEBA ${suf}`, iva: 0, precio_caja: 5000, activo: true, unidades: 10, lote: "L1", vence: "2030-01-01", costo_unidad: 3000 },
  { externo_id: `F${suf}`, nombre: `FANTASMA INACTIVO ${suf}`, iva: 0, precio_caja: 16920, activo: false, unidades: 641, lote: "12422", vence: "2028-07-16", costo_unidad: 6768 },
  { externo_id: `Z${suf}`, nombre: `INACTIVO SIN SALDO ${suf}`, iva: 0, precio_caja: 1000, activo: false, unidades: 0 },
];
const stock = async (ext) => Number((await q(`select coalesce(sum(s.unidades), 0) u from productos p left join v_stock_lotes s on s.producto_id = p.id where p.empresa_id = $1 and p.externo_id = $2`, [E, ext]))[0].u);
const activo = async (ext) => (await q(`select activo from productos where empresa_id = $1 and externo_id = $2`, [E, ext]))[0]?.activo;

const sim = await mig({ simular: true });
ok(sim.s === 200 && sim.j.resumen?.inactivos_con_existencias === 1, "simular avisa de 1 artículo inactivo con existencias", JSON.stringify(sim.j).slice(0, 200));
ok(sim.j.inactivos?.decision === "omitir" && sim.j.inactivos.lista?.[0]?.unidades === 641, "por defecto la decisión es omitirlo y lo lista con sus unidades");
ok(sim.j.resumen?.unidades === 10, "las unidades finales simuladas no cuentan el saldo fantasma", String(sim.j.resumen?.unidades));

const ap = await mig({ simular: false });
ok(ap.s === 200, "aplicar responde 200", JSON.stringify(ap.j).slice(0, 160));
ok(await stock(`A${suf}`) === 10, "el activo entra con sus 10 unidades");
ok(await stock(`F${suf}`) === 0 && (await activo(`F${suf}`)) === false, "el inactivo con saldo queda inactivo y en cero");

const rep = await mig({ simular: false, inactivos: "importar" });
ok(rep.s === 200 && await stock(`F${suf}`) === 641, "con «importar» (confirmado en físico) sí entran las 641", String(await stock(`F${suf}`)));
ok(await stock(`A${suf}`) === 10, "repetir no duplica el activo");
ok((await llamar(`/api/admin/clientes/${E}/migracion`, { parte: "productos", reemplazar: false, simular: true, inactivos: "borrar", filas }, adm)).s === 400, "una decisión desconocida se rechaza");

await pool.end();
console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
process.exit(fallos ? 1 : 0);
