// Recrea la base local desde cero: stub de Supabase (solo local), migraciones y datos de demostración.
// Uso: DATABASE_URL=postgres://postgres@localhost:5433/regenta?host=/tmp node scripts/db-reset.mjs
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("db-reset solo se ejecuta contra una base local");
const nombre = new URL(url).pathname.slice(1);
const admin = new pg.Client({ connectionString: url.replace(`/${nombre}`, "/postgres") });
await admin.connect();
await admin.query(`drop database if exists ${nombre} with (force)`);
await admin.query(`create database ${nombre}`);
await admin.end();

const db = new pg.Client({ connectionString: url });
await db.connect();
const sql = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
await db.query(sql("../db/local/00_supabase_stub.sql"));
for (const f of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) {
  await db.query(sql(`../db/migrations/${f}`));
  console.log("migración", f);
}

// Catálogo maestro (común a todas las empresas).
const M = JSON.parse(sql("../db/seed/maestro.json"));
for (let i = 0; i < M.length; i += 1000) {
  const parte = M.slice(i, i + 1000);
  await db.query(
    `insert into productos_maestro (ref, nombre, laboratorio, ean, iva, categoria)
     select * from jsonb_to_recordset($1::jsonb) as x(ref text, nombre text, laboratorio text, ean text, iva numeric, categoria text)`,
    [JSON.stringify(parte)],
  );
}
console.log("catálogo maestro:", M.length);

// Demostración: dos droguerías (para probar el aislamiento) con usuarios fijos.
const U = {
  carlos: "00000000-0000-4000-8000-000000000001", // dueño A
  cajeraA: "00000000-0000-4000-8000-000000000002", // cajera A
  bodegaA: "00000000-0000-4000-8000-000000000003", // bodeguero A
  duenoB: "00000000-0000-4000-8000-000000000004", // dueño B
};
const E = { A: "10000000-0000-4000-8000-00000000000a", B: "10000000-0000-4000-8000-00000000000b" };
const S = { A: "20000000-0000-4000-8000-00000000000a", B: "20000000-0000-4000-8000-00000000000b" };
const C = { A: "30000000-0000-4000-8000-00000000000a", B: "30000000-0000-4000-8000-00000000000b" };
await db.query(`insert into auth.users (id, email) values
  ($1, 'carlos@demo.regenta.co'), ($2, 'cajera@demo.regenta.co'), ($3, 'bodega@demo.regenta.co'), ($4, 'dueno.b@demo.regenta.co')`,
  [U.carlos, U.cajeraA, U.bodegaA, U.duenoB]);
await db.query(`insert into empresas (id, nit, dv, razon_social, nombre_comercial, ciudad, direccion, telefono) values
  ($1, '900000001', '1', 'DROGUERÍA DEMO CARLOS S.A.S.', 'Droguería Demo', 'Ibagué', 'Calle 1 # 2-3', '3000000000'),
  ($2, '900000002', '2', 'DROGUERÍA VECINA S.A.S.', 'Droguería Vecina', 'Ibagué', 'Calle 9 # 9-9', '3000000001')`, [E.A, E.B]);
await db.query(`insert into sedes (id, empresa_id, nombre, ciudad) values ($1, $2, 'Principal', 'Ibagué'), ($3, $4, 'Principal', 'Ibagué')`, [S.A, E.A, S.B, E.B]);
await db.query(`insert into cajas (id, empresa_id, sede_id, nombre) values ($1, $2, $3, 'Caja 1'), ($4, $5, $6, 'Caja 1')`, [C.A, E.A, S.A, C.B, E.B, S.B]);
await db.query(`insert into miembros (empresa_id, user_id, nombre, rol) values
  ($1, $2, 'Carlos (dueño)', 'dueno'), ($1, $3, 'Laura (cajera)', 'cajero'), ($1, $4, 'Andrés (bodega)', 'bodeguero'),
  ($5, $6, 'Dueño Vecina', 'dueno')`, [E.A, U.carlos, U.cajeraA, U.bodegaA, E.B, U.duenoB]);
await db.query(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, vigente_hasta, pruebas) values
  ($1, 'pos', 'SETP', 990000000, 995000000, 989999999, '2027-12-31', true),
  ($1, 'factura', 'SETT', 1, 5000000, 0, '2027-12-31', true),
  ($2, 'pos', 'POSB', 1, 1000000, 0, '2027-12-31', true)`, [E.A, E.B]);

// Productos de la droguería demo: 400 del catálogo maestro con EAN, precio al público de ejemplo.
// Surtido típico de droguería de barrio: primero lo que más se vende, luego el resto hasta 600.
const COMUNES = /acetaminofen|ibuprofeno|naproxeno|diclofenaco|losartan|enalapril|metformina|omeprazol|esomeprazol|amoxicilina|azitromicina|cefalexina|loratadina|cetirizina|salbutamol|dolex|advil|noxpirin|sal de frutas|alka|suero|electrolit|colgate|crema dental|pañal|toallas|preservativo|condon|vitamina c|complejo b|acido folico|sulfato ferroso|metronidazol|secnidazol|fluconazol|clotrimazol|hidrocortisona|ranitidina|loperamida|buscapina|mareol|bonfiest|aspirina|winadeine|desenfriol|noraver|vick|gasa|venda|alcohol|isodine|jeringa|termometro|tapabocas/i;
const conEan = M.filter((m) => m.ean && m.ref_precio > 0);
const elegidos = [...conEan.filter((m) => COMUNES.test(m.nombre)), ...conEan.filter((m) => !COMUNES.test(m.nombre))].slice(0, 600);
const filas = elegidos.map((m, i) => {
  // Se fracciona solo lo sólido oral en caja o frasco («tabletas … caja x 48», «capsulas … x 30 unds»).
  const solido = /tableta|capsula|cápsula|comprimido|gragea/i.test(m.nombre);
  const porCaja = solido ? /(?:caja|frasco|blister)\s*x\s*(\d{1,3})\b|x\s*(\d{2,3})\s*unds?\b/i.exec(m.nombre) : null;
  const upc = porCaja ? Number(porCaja[1] ?? porCaja[2]) : 1;
  const pc = Math.ceil((m.ref_precio * 1.35) / 50) * 50;
  return { ref: m.ref, upc, pc, pu: upc > 1 ? Math.ceil(pc / upc / 50) * 50 + 50 : null, min: i % 7 };
});
await db.query(
  `insert into productos (empresa_id, maestro_id, nombre, laboratorio, ean, iva, categoria, unidades_por_caja, precio_caja, precio_unidad, stock_minimo)
   select $1, m.id, m.nombre, m.laboratorio, m.ean, m.iva, m.categoria, x.upc, x.pc, x.pu, x.min
   from jsonb_to_recordset($2::jsonb) as x(ref text, upc int, pc numeric, pu numeric, min int)
   join productos_maestro m on m.ref = x.ref`,
  [E.A, JSON.stringify(filas)],
);
// Existencias iniciales: dos lotes por producto, uno que vence pronto (para ver el semáforo) y otro lejos.
const { rows: prods } = await db.query(`select p.id, p.unidades_por_caja, m.ref from productos p join productos_maestro m on m.id = p.maestro_id where p.empresa_id = $1 order by p.nombre`, [E.A]);
const costo = Object.fromEntries(elegidos.map((m) => [m.ref, m.ref_precio]));
const hoy = new Date();
const fecha = (dias) => new Date(hoy.getTime() + dias * 864e5).toISOString().slice(0, 10);
const lineas = [];
prods.forEach((p, i) => {
  if (i % 11 === 10) return; // algunos sin existencias
  lineas.push({ producto_id: p.id, lote: `L${2600 + i}A`, vence: fecha(i % 5 === 0 ? 20 + (i % 40) : 120 + (i % 200)), unidades: p.unidades_por_caja * (2 + (i % 4)), costo_unidad: Math.round(costo[p.ref] / p.unidades_por_caja) });
  lineas.push({ producto_id: p.id, lote: `L${2600 + i}B`, vence: fecha(400 + (i % 300)), unidades: p.unidades_por_caja * (3 + (i % 6)), costo_unidad: Math.round(costo[p.ref] / p.unidades_por_caja) });
});
// Se carga como el dueño, por la misma función que usará la app (respeta permisos y auditoría).
await db.query("begin");
await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.carlos, role: "authenticated" })]);
await db.query("set local role authenticated");
await db.query(`select registrar_entrada($1::jsonb)`, [JSON.stringify({ empresa_id: E.A, sede_id: S.A, tipo: "inicial", lineas })]);
await db.query("commit");
console.log("demo: productos", prods.length, "· lotes", lineas.length);
await db.end();
