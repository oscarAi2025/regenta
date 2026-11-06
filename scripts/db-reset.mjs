// LOCAL: recrea la base desde cero: stub de Supabase (solo local), migraciones y datos de demostración.
//   DATABASE_URL=postgres://postgres@localhost:5433/regenta?host=/tmp node scripts/db-reset.mjs
// PRODUCCIÓN (Supabase): aplica solo las migraciones pendientes (quedan registradas en regenta_migraciones) y carga el
// catálogo maestro y las alertas INVIMA si están vacíos. Nunca borra nada. Con --demo crea además la droguería de
// demostración si no existe. La conexión se verifica con la CA de Supabase (DATABASE_CA = ruta al .crt o el PEM).
//   DATABASE_URL=<pooler en modo sesión, puerto 5432> DATABASE_CA=./prod-ca-2021.crt node scripts/db-reset.mjs --produccion [--demo]
import pg from "pg";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const PROD = process.argv.includes("--produccion"), DEMO = !PROD || process.argv.includes("--demo");
const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const local = /localhost|127\.0\.0\.1|host=\/tmp/.test(url);
if (!PROD && !local) throw new Error("db-reset sin --produccion solo se ejecuta contra una base local");
const sql = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
let db;
if (!PROD) {
  const nombre = new URL(url).pathname.slice(1);
  const admin = new pg.Client({ connectionString: url.replace(`/${nombre}`, "/postgres") });
  await admin.connect();
  await admin.query(`drop database if exists ${nombre} with (force)`);
  await admin.query(`create database ${nombre}`);
  await admin.end();
  db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query(sql("../db/local/00_supabase_stub.sql"));
} else {
  const ca = process.env.DATABASE_CA ? (existsSync(process.env.DATABASE_CA) ? readFileSync(process.env.DATABASE_CA, "utf8") : process.env.DATABASE_CA.replace(/\\n/g, "\n")) : undefined;
  db = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/g, ""), ...(local ? {} : { ssl: { ca, rejectUnauthorized: true } }) });
  await db.connect();
}
await db.query(`create table if not exists regenta_migraciones (nombre text primary key, aplicada timestamptz not null default now())`);
await db.query(`revoke all on regenta_migraciones from public`);
const hechas = new Set((await db.query(`select nombre from regenta_migraciones`)).rows.map((r) => r.nombre));
for (const f of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) {
  if (hechas.has(f)) continue;
  await db.query("begin");
  try { await db.query(sql(`../db/migrations/${f}`)); await db.query(`insert into regenta_migraciones (nombre) values ($1)`, [f]); await db.query("commit"); }
  catch (e) { await db.query("rollback"); console.error(`La migración ${f} falló y no se aplicó:`, e.message); process.exit(1); }
  console.log("migración", f);
}

// Catálogo maestro (común a todas las empresas).
const M = JSON.parse(sql("../db/seed/maestro.json"));
const yaMaestro = Number((await db.query(`select count(*) n from productos_maestro`)).rows[0].n) > 0;
if (!yaMaestro) for (let i = 0; i < M.length; i += 1000) {
  const parte = M.slice(i, i + 1000);
  await db.query(
    `insert into productos_maestro (ref, nombre, laboratorio, ean, iva, categoria)
     select * from jsonb_to_recordset($1::jsonb) as x(ref text, nombre text, laboratorio text, ean text, iva numeric, categoria text)`,
    [JSON.stringify(parte)],
  );
}
console.log("catálogo maestro:", M.length);

// Alertas sanitarias reales del INVIMA (verificadas en invima.gov.co el 01/11/2026). En producción las trae /api/invima.
const AL = JSON.parse(sql("../db/seed/alertas_invima.json"));
if (Number((await db.query(`select count(*) n from alertas_invima`)).rows[0].n) === 0) await db.query(`insert into alertas_invima (numero, tipo, titulo, motivo, fecha, url, pdf, registros, lotes, palabras, resumen, recomendacion)
  select numero, tipo, titulo, motivo, fecha, url, pdf, registros, lotes, palabras, resumen, recomendacion
  from jsonb_to_recordset($1::jsonb) as x(numero text, tipo text, titulo text, motivo text, fecha date, url text, pdf text, registros text[], lotes text[], palabras text[], resumen text, recomendacion text)`, [JSON.stringify(AL)]);
console.log("alertas INVIMA:", AL.length);

if (!DEMO || (await db.query(`select 1 from empresas where demo`)).rowCount) {
  console.log(PROD ? "listo (producción)" : "listo");
  await db.end();
  process.exit(0);
}

// Demostración: dos droguerías (para probar el aislamiento) con usuarios fijos. En producción, solo la de demostración.
const U = {
  carlos: "00000000-0000-4000-8000-000000000001", // dueño A
  cajeraA: "00000000-0000-4000-8000-000000000002", // cajera A
  bodegaA: "00000000-0000-4000-8000-000000000003", // bodeguero A
  duenoB: "00000000-0000-4000-8000-000000000004", // dueño B
};
const E = { A: "10000000-0000-4000-8000-00000000000a", B: "10000000-0000-4000-8000-00000000000b" };
const S = { A: "20000000-0000-4000-8000-00000000000a", B: "20000000-0000-4000-8000-00000000000b" };
const C = { A: "30000000-0000-4000-8000-00000000000a", B: "30000000-0000-4000-8000-00000000000b" };
if (!PROD) await db.query(`insert into auth.users (id, email) values
  ($1, 'carlos@demo.regenta.co'), ($2, 'cajera@demo.regenta.co'), ($3, 'bodega@demo.regenta.co'), ($4, 'dueno.b@demo.regenta.co')`,
  [U.carlos, U.cajeraA, U.bodegaA, U.duenoB]);
await db.query(`insert into empresas (id, nit, dv, razon_social, nombre_comercial, ciudad, direccion, telefono) values
  ($1, '900000001', '1', 'DROGUERÍA DEMO CARLOS S.A.S.', 'Droguería Demo', 'Ibagué', 'Calle 1 # 2-3', '3000000000')`, [E.A]);
await db.query(`insert into sedes (id, empresa_id, nombre, ciudad) values ($1, $2, 'Principal', 'Ibagué')`, [S.A, E.A]);
await db.query(`update empresas set demo = true where id = $1`, [E.A]); // la droguería pública de demostración
await db.query(`insert into cajas (id, empresa_id, sede_id, nombre) values ($1, $2, $3, 'Caja 1')`, [C.A, E.A, S.A]);
await db.query(`insert into miembros (empresa_id, user_id, nombre, rol) values
  ($1, $2, 'Carlos (dueño)', 'dueno'), ($1, $3, 'Laura (cajera)', 'cajero'), ($1, $4, 'Andrés (bodega)', 'bodeguero')`, [E.A, U.carlos, U.cajeraA, U.bodegaA]);
await db.query(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, vigente_hasta, pruebas) values
  ($1, 'pos', 'SETP', 990000000, 995000000, 989999999, '2027-12-31', true),
  ($1, 'factura', 'SETT', 1, 5000000, 0, '2027-12-31', true),
  ($1, 'nota_credito', 'NCSE', 1, 1000000, 0, '2027-12-31', true)`, [E.A]);
// Segunda droguería, solo en local: las pruebas comprueban que una empresa nunca ve los datos de otra.
if (!PROD) {
  await db.query(`insert into empresas (id, nit, dv, razon_social, nombre_comercial, ciudad, direccion, telefono) values ($1, '900000002', '2', 'DROGUERÍA VECINA S.A.S.', 'Droguería Vecina', 'Ibagué', 'Calle 9 # 9-9', '3000000001')`, [E.B]);
  await db.query(`insert into sedes (id, empresa_id, nombre, ciudad) values ($1, $2, 'Principal', 'Ibagué')`, [S.B, E.B]);
  await db.query(`insert into cajas (id, empresa_id, sede_id, nombre) values ($1, $2, $3, 'Caja 1')`, [C.B, E.B, S.B]);
  await db.query(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Dueño Vecina', 'dueno')`, [E.B, U.duenoB]);
  await db.query(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, vigente_hasta, pruebas) values ($1, 'pos', 'POSB', 1, 1000000, 0, '2027-12-31', true)`, [E.B]);
}

// Productos de la droguería demo: 400 del catálogo maestro con EAN, precio al público de ejemplo.
// Surtido típico de droguería de barrio: primero lo que más se vende, luego el resto hasta 600.
const COMUNES = /acetaminofen|ibuprofeno|naproxeno|diclofenaco|losartan|enalapril|metformina|omeprazol|esomeprazol|amoxicilina|azitromicina|cefalexina|loratadina|cetirizina|salbutamol|dolex|advil|noxpirin|sal de frutas|alka|suero|electrolit|colgate|crema dental|pañal|toallas|preservativo|condon|vitamina c|complejo b|acido folico|sulfato ferroso|metronidazol|secnidazol|fluconazol|clotrimazol|hidrocortisona|ranitidina|loperamida|buscapina|mareol|bonfiest|aspirina|winadeine|desenfriol|noraver|vick|gasa|venda|alcohol|isodine|jeringa|termometro|tapabocas/i;
// Para que la demo se vea como una droguería de barrio: fuera las referencias de precio de distribución por bulto (> $90.000 la presentación).
const conEan = M.filter((m) => m.ean && m.ref_precio > 0 && m.ref_precio <= 90000);
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
const { rows: prods } = await db.query(`select p.id, p.nombre, p.unidades_por_caja, m.ref from productos p join productos_maestro m on m.id = p.maestro_id where p.empresa_id = $1 order by p.nombre`, [E.A]);
const costo = Object.fromEntries(elegidos.map((m) => [m.ref, m.ref_precio]));
const hoy = new Date();
const fecha = (dias) => new Date(hoy.getTime() + dias * 864e5).toISOString().slice(0, 10);
const lineas = [];
prods.forEach((p, i) => {
  if (i % 11 === 10) return; // algunos sin existencias
  lineas.push({ producto_id: p.id, lote: `L${2600 + i}A`, vence: fecha(i % 5 === 0 ? 20 + (i % 40) : 120 + (i % 200)), unidades: p.unidades_por_caja * (i % 5 === 0 && COMUNES.test(p.nombre) ? 6 : 1 + (i % 2)), costo_unidad: Math.round(costo[p.ref] / p.unidades_por_caja) });
  lineas.push({ producto_id: p.id, lote: `L${2600 + i}B`, vence: fecha(400 + (i % 300)), unidades: p.unidades_por_caja * (1 + (i % 3)), costo_unidad: Math.round(costo[p.ref] / p.unidades_por_caja) });
});
// Para mostrar el cruce con el INVIMA: la droguería demo tiene el lote F0537A de Buscapina Compositum NF (alerta 329-2026).
const busc = prods.find((p) => /^Buscapina compositum nf comprimidos caja x 20/i.test(p.nombre ?? ""));
if (busc) {
  await db.query(`update productos set registro_sanitario = 'INVIMA 2020M-003171-R4' where id = $1`, [busc.id]);
  lineas.push({ producto_id: busc.id, lote: "F0537A", vence: "2029-07-31", unidades: 40, costo_unidad: 900 });
}
// Se carga como el dueño, por la misma función que usará la app (respeta permisos y auditoría).
await db.query("begin");
await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.carlos, role: "authenticated" })]);
await db.query("set local role authenticated");
await db.query(`select registrar_entrada($1::jsonb)`, [JSON.stringify({ empresa_id: E.A, sede_id: S.A, tipo: "inicial", lineas })]);
await db.query("commit");
console.log("demo: productos", prods.length, "· lotes", lineas.length);

// Historia de 8 semanas para que la demo (sus predicciones y capturas) muestre un negocio real: unos pocos productos
// se venden mucho y la mayoría poco. Primero se planean las ventas, luego entra una compra hace 57 días ajustada a lo
// planeado (a unos productos les alcanzará justo: ésos saldrán en el pedido sugerido), y las ventas se registran por
// registrar_venta como la cajera. Al final se reparten en el tiempo (solo aquí, en la siembra, sin triggers).
let semilla = 7;
const azar = () => ((semilla = (semilla * 16807) % 2147483647) - 1) / 2147483646;
const { rows: catalogoA } = await db.query(`select p.id, p.nombre, p.precio_caja::float pc, p.precio_unidad::float pu, p.unidades_por_caja upc, (select costo_unidad::float from lote_costos lc join lotes l on l.id = lc.lote_id where l.producto_id = p.id limit 1) costo
  from productos p where p.empresa_id = $1 order by p.nombre`, [E.A]);
// Orden de popularidad: los de uso común primero, mezclados de forma reproducible.
const populares = [...catalogoA.filter((p) => COMUNES.test(p.nombre)), ...catalogoA.filter((p) => !COMUNES.test(p.nombre))]
  .map((p, i) => ({ p, k: (i < 300 ? 0 : 1) + azar() })).sort((a, b) => a.k - b.k).map((x) => x.p).slice(0, 380);
const MEDIOS = ["efectivo", "efectivo", "efectivo", "nequi", "nequi", "daviplata", "tarjeta", "bre_b"];
const ahora = new Date();
const minutosHoy = (ahora.getUTCHours() * 60 + ahora.getUTCMinutes() - 5 * 60 + 1440) % 1440; // minuto del día en Bogotá
const lleno = process.env.REGENTA_CAPTURAS === "1"; // llena el día de hoy completo (solo para generar capturas)
const plan = [];
for (let dia = 55; dia >= 0; dia--) {
  const dow = new Date(ahora.getTime() - dia * 864e5).getUTCDay(), domingo = dow === 0, fuerte = dow === 5 || dow === 6; // viernes y sábado se vende más
  const n = dia === 0 && !lleno ? Math.max(0, Math.min(14, Math.floor((minutosHoy - 7 * 60) / 50))) : Math.round((domingo ? 9 : fuerte ? 21 : 15) + azar() * 10 + (55 - dia) / 10);
  for (let k = 0; k < n; k++) {
    const ls = [];
    for (let j = 0, m = 1 + Math.floor(azar() * 3); j < m; j++) {
      const pr = populares[Math.floor(populares.length * Math.pow(azar(), 1.7))];
      if (ls.some((l) => l.producto_id === pr.id)) continue;
      const suelto = pr.pu && pr.upc > 1 && azar() < 0.55;
      const cantidad = suelto ? 2 + Math.floor(azar() * 8) : 1;
      ls.push({ producto_id: pr.id, presentacion: suelto ? "unidad" : "caja", cantidad, precio: suelto ? pr.pu : pr.pc, unidades: suelto ? cantidad : pr.upc });
    }
    const tope = dia === 0 && !lleno ? Math.max(7 * 60 + 1, minutosHoy - 2) : 21 * 60;
    plan.push({ dia, minuto: 7 * 60 + Math.floor(azar() * (tope - 7 * 60)), ls });
  }
}
// Compra hace 57 días: lo planeado × 0,85–1,5 en cajas completas (los de factor bajo se quedan cortos).
const necesita = new Map();
for (const v of plan) for (const l of v.ls) necesita.set(l.producto_id, (necesita.get(l.producto_id) ?? 0) + l.unidades);
const compra = [];
for (const p of catalogoA) {
  const u = necesita.get(p.id); if (!u) continue;
  const f = 0.85 + azar() * 0.65;
  compra.push({ producto_id: p.id, lote: `C${String(compra.length + 1).padStart(4, "0")}`, vence: fecha(250 + Math.floor(azar() * 500)), unidades: Math.ceil((u * f) / p.upc) * p.upc, costo_unidad: p.costo ?? Math.round((p.pc / p.upc) * 0.7) });
}
await db.query("begin");
await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.carlos, role: "authenticated" })]);
await db.query("set local role authenticated");
await db.query(`select registrar_entrada($1::jsonb)`, [JSON.stringify({ empresa_id: E.A, sede_id: S.A, tipo: "compra", motivo: "Proveedor: compra de surtido", lineas: compra })]);
await db.query("commit");

const ventasDemo = [];
let fallidas = 0;
for (const v of plan) {
  const total = v.ls.reduce((a, l) => a + l.precio * l.cantidad, 0);
  const medio = MEDIOS[Math.floor(azar() * MEDIOS.length)];
  const valor = medio === "efectivo" ? Math.ceil(total / 10000) * 10000 : total;
  await db.query("begin");
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.cajeraA, role: "authenticated" })]);
  await db.query("set local role authenticated");
  try {
    const r = (await db.query(`select registrar_venta($1::jsonb) r`, [JSON.stringify({ empresa_id: E.A, sede_id: S.A, caja_id: C.A, idem_key: crypto.randomUUID(), tipo_doc: "pos",
      lineas: v.ls.map(({ presentacion, producto_id, cantidad }) => ({ producto_id, presentacion, cantidad })), pagos: [{ medio, valor }] })])).rows[0].r;
    await db.query("commit");
    ventasDemo.push({ id: r.venta_id, dia: v.dia, minuto: v.minuto });
  } catch (e) { await db.query("rollback"); if (fallidas++ === 0) console.error("venta demo:", e.message); }
}

// Clientes con NIT y facturas a crédito (convenios de la droguería): dos al día, una con abono parcial y una vencida.
const CLIENTES = [
  ["NIT", "900456789", "4", "Hogar Geriátrico San José S.A.S.", "compras@hogarsanjose.example"],
  ["NIT", "901234567", "7", "IPS Salud Vital Ibagué S.A.S.", "facturas@saludvital.example"],
  ["NIT", "800987654", "4", "Transportes del Tolima Ltda. (botiquines)", "contabilidad@transtolima.example"],
  ["CC", "1110456789", null, "María Fernanda Rojas", null],
];
const cli = [];
for (const [t, n, dv, nombre, email] of CLIENTES)
  cli.push((await db.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, dv, nombre, email, autoriza_datos) values ($1, $2, $3, $4, $5, $6, true) returning id`, [E.A, t, n, dv, nombre, email])).rows[0].id);
const creditos = [[0, 45, 30, 0.5], [1, 20, 30, 0], [2, 12, 15, 0], [0, 6, 30, 0], [1, 52, 45, 1]]; // cliente, hace días, plazo, fracción abonada
const conStock = (await db.query(`select s.producto_id, p.unidades_por_caja upc, sum(s.unidades)::int u from v_stock_vigente s join productos p on p.id = s.producto_id
  where s.empresa_id = $1 group by 1, 2 having sum(s.unidades) >= p.unidades_por_caja * 6 order by 3 desc limit 40`, [E.A])).rows;
const creditosDemo = [];
for (const [k, [ci, dia, plazo, fr]] of creditos.entries()) {
  const ls = conStock.slice(k * 6, k * 6 + 4).map((p, i) => ({ producto_id: p.producto_id, presentacion: "caja", cantidad: 1 + (i % 3) }));
  await db.query("begin");
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.carlos, role: "authenticated" })]);
  await db.query("set local role authenticated");
  const r = (await db.query(`select registrar_venta($1::jsonb) r`, [JSON.stringify({ empresa_id: E.A, sede_id: S.A, caja_id: C.A, idem_key: crypto.randomUUID(), tipo_doc: "factura",
    cliente_id: cli[ci], condicion: "credito", plazo_dias: plazo, lineas: ls, pagos: [] })])).rows[0].r;
  if (fr > 0) await db.query(`select registrar_abono($1, 'transferencia', $2, 'Abono convenio')`, [r.venta_id, Math.round(Number(r.total) * fr)]);
  await db.query("commit");
  ventasDemo.push({ id: r.venta_id, dia, minuto: 600 + k * 37 });
  creditosDemo.push(r.venta_id);
}
// Venta con fórmula y control especial (migración 030): un analgésico con codeína marcado de control especial y dos
// antibióticos que se venden con fórmula. Se marcan después de la historia (antes se vendían sin marca) y se registran
// unas dispensaciones con su fórmula por la misma ruta que la caja, para que el libro de la demo no esté vacío.
const controlado = prods.find((p) => /^Winadeine f tabletas 325mg\/30mg/i.test(p.nombre ?? ""));
const conFormula = prods.filter((p) => /^(Amoxicilina tableta 875 mg caja x 14|Cefalexina genfar capsulas 500 mg caja x 10)/i.test(p.nombre ?? ""));
if (controlado) {
  await db.query(`update productos set requiere_formula = true, control_especial = true where id = $1`, [controlado.id]);
  await db.query(`update productos set requiere_formula = true where id = any($1)`, [conFormula.map((p) => p.id)]);
  await db.query("begin");
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.carlos, role: "authenticated" })]);
  await db.query("set local role authenticated");
  await db.query(`select registrar_entrada($1::jsonb)`, [JSON.stringify({ empresa_id: E.A, sede_id: S.A, tipo: "compra", motivo: "Proveedor: compra de control especial",
    lineas: [{ producto_id: controlado.id, lote: "W2611", vence: fecha(540), unidades: 60, costo_unidad: 5200 }] })]);
  await db.query("commit");
  const DISPENSA = [
    [18, 4, "CC", "52345678", "Gloria Inés Martínez", "Jorge Restrepo Gómez", "RM 73-1458", "F-10234"],
    [9, 6, "CC", "93412987", "Luis Alberto Cárdenas", "Ana María Ospina", "RM 73-2290", "F-10511"],
    [2, 10, "TI", "1105678234", "Valentina Rojas Díaz", "Jorge Restrepo Gómez", "RM 73-1458", "F-10687"],
  ];
  for (const [dia, unidades, tdoc, doc, paciente, medico, registro, numero] of DISPENSA) {
    await db.query("begin");
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.cajeraA, role: "authenticated" })]);
    await db.query("set local role authenticated");
    const r = (await db.query(`select registrar_venta($1::jsonb) r`, [JSON.stringify({ empresa_id: E.A, sede_id: S.A, caja_id: C.A, idem_key: crypto.randomUUID(), tipo_doc: "pos",
      lineas: [{ producto_id: controlado.id, presentacion: "unidad", cantidad: unidades }], pagos: [{ medio: "efectivo", valor: 100000 }] })])).rows[0].r;
    await db.query(`select registrar_formulas_venta($1, $2::jsonb)`, [r.venta_id, JSON.stringify({ verificada: true, paciente_tipo_doc: tdoc, paciente_doc: doc, paciente_nombre: paciente,
      medico_nombre: medico, medico_registro: registro, formula_numero: numero, formula_fecha: fecha(-(dia + 1)) })]);
    await db.query("commit");
    ventasDemo.push({ id: r.venta_id, dia, minuto: 610 + dia * 13 });
  }
  console.log("demo: control especial", controlado.nombre, "· con fórmula", conFormula.length);
}

// Reparto en el tiempo: ventas, sus movimientos y documentos; la compra hace 57 días y el inventario inicial hace 60.
// Los triggers que protegen ventas, movimientos, abonos y documentos se apagan solo dentro de esta transacción. Se hace
// con ALTER TABLE (basta ser dueño de la tabla), así funciona igual en Supabase, que no da superusuario.
const HISTORIA = ["ventas", "movimientos", "abonos", "documentos_dian"];
await db.query("begin");
for (const t of HISTORIA) await db.query(`alter table ${t} disable trigger user`);
await db.query(`create temp table _t (id uuid, dia int, minuto int) on commit drop`);
await db.query(`insert into _t select * from jsonb_to_recordset($1::jsonb) as x(id uuid, dia int, minuto int)`, [JSON.stringify(ventasDemo)]);
await db.query(`update ventas v set creado = (date_trunc('day', now() at time zone 'America/Bogota') - make_interval(days => t.dia) + make_interval(mins => t.minuto)) at time zone 'America/Bogota' from _t t where v.id = t.id`);
await db.query(`update movimientos m set creado = v.creado from ventas v where m.tipo = 'venta' and m.ref_id = v.id and v.empresa_id = $1`, [E.A]);
await db.query(`update ventas set vence_pago = (creado at time zone 'America/Bogota')::date + plazo_dias where empresa_id = $1 and condicion = 'credito'`, [E.A]);
await db.query(`update abonos a set creado = v.creado + interval '9 days' from ventas v where v.id = a.venta_id and a.empresa_id = $1`, [E.A]);
await db.query(`update documentos_dian d set estado = 'aceptado', simulado = true, intentos = 1, cufe = encode(sha384(convert_to('SIMULADO-' || d.id::text, 'UTF8')), 'hex') where d.empresa_id = $1`, [E.A]);
await db.query(`update movimientos set creado = now() - interval '57 days' where empresa_id = $1 and tipo = 'compra'`, [E.A]);
await db.query(`update movimientos set creado = now() - interval '60 days' where empresa_id = $1 and tipo = 'inicial'`, [E.A]);
for (const t of HISTORIA) await db.query(`alter table ${t} enable trigger user`);
await db.query("commit");
// Estadísticas al día (como en producción, donde las mantiene el autovacuum): sin ellas los planes salen malos y las
// primeras consultas tras sembrar tardan segundos.
await db.query("analyze");
console.log("demo: ventas", ventasDemo.length, fallidas ? `(${fallidas} sin existencias)` : "");
await db.end();
