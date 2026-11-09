// Migración desde Alegra por la consola, con los datos reales de Farmagenéricos convertidos (MIG_DIR: productos.json,
// clientes.json, proveedores.json, ventas.json) sobre la droguería VECINA (no demo). Comprueba: simular no cambia nada;
// aplicar deja las existencias EXACTAMENTE como en Alegra (unidades y valor a costo), con lo que sobraba en cero y
// ajustes numerados; repetir no duplica nada; clientes, proveedores, historial y cartera completos; la cartera de
// Alegra se cobra con abonos y no se puede anular; nada de Alegra entra a los informes, a la caja ni a la DIAN.
// Uso: servidor en :4540 → MIG_DIR=… node tests/e2e/migracion.mjs
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { codigoTotp, TOTP } from "../ayudas/totp.mjs";

const B = process.env.BASE ?? "http://localhost:4540";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const DIR = process.env.MIG_DIR;
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const leer = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), "utf8"));
const productos = leer("productos.json"), clientes = leer("clientes.json"), proveedores = leer("proveedores.json"), ventas = leer("ventas.json");
const E = "10000000-0000-4000-8000-00000000000b"; // DROGUERÍA VECINA
const suf = Date.now().toString().slice(-7);
const IP = `10.78.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function llamar(metodo, ruta, cuerpo, cookie) {
  const r = await fetch(B + ruta, { method: metodo, redirect: "manual", headers: { origin: B, "x-real-ip": IP, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  return { s: r.status, j, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
}
const ADMIN = `admin${suf}@migracion.test`;
execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN, "Admin Migración"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: "ConsolaMigra2026", REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });
const adm = (await llamar("POST", "/api/acceso", { email: ADMIN, clave: "ConsolaMigra2026", consola: true, codigo: codigoTotp() })).cookie;
ok(adm.startsWith("regenta_admin="), "la consola entra");
const mig = (cuerpo) => llamar("POST", `/api/admin/clientes/${E}/migracion`, cuerpo, adm);

// Estado previo de VECINA: un producto que también está en Alegra (mismo nombre, otro lote) y otro que Alegra no tiene.
const sede = (await q(`select id from sedes where empresa_id = $1 limit 1`, [E]))[0].id;
const dueno = (await q(`select user_id from miembros where empresa_id = $1 and rol = 'dueno' limit 1`, [E]))[0].user_id;
const conStock = productos.filter((p) => p.unidades > 0);
const comun = conStock[0];
const [pComun] = await q(`insert into productos (empresa_id, nombre, iva, precio_caja) values ($1, $2, 0, 1000) returning id`, [E, comun.nombre.toLowerCase()]);
const [pViejo] = await q(`insert into productos (empresa_id, nombre, iva, precio_caja) values ($1, 'PRODUCTO QUE ALEGRA NO TIENE', 0, 1000) returning id`, [E]);
const entrar = async (lineas) => {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: dueno })]); await c.query("set local role authenticated");
    await c.query(`select registrar_entrada($1)`, [{ empresa_id: E, sede_id: sede, tipo: "inicial", lineas }]); await c.query("commit"); }
  catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
};
await entrar([{ producto_id: pComun.id, lote: "VIEJO1", vence: "2030-01-01", unidades: 7, costo_unidad: 100 }, { producto_id: pViejo.id, lote: "X1", vence: "2030-01-01", unidades: 5, costo_unidad: 100 }]);
const fotos = async () => (await q(`select (select count(*) from productos where empresa_id = $1)::int productos, (select coalesce(sum(unidades), 0)::int from v_stock_lotes where empresa_id = $1) unidades,
  (select count(*) from clientes where empresa_id = $1)::int clientes, (select count(*) from proveedores where empresa_id = $1)::int proveedores,
  (select count(*) from ventas_externas where empresa_id = $1)::int historial, (select count(*) from ventas where empresa_id = $1)::int ventas,
  (select count(*) from ajustes where empresa_id = $1)::int ajustes, (select count(*) from movimientos where empresa_id = $1)::int movimientos`, [E]))[0];
const antes = await fotos();

// ── Validación y permisos
ok((await llamar("POST", `/api/admin/clientes/${E}/migracion`, { parte: "clientes", simular: true, filas: clientes })).s === 401, "sin sesión de consola no se migra");
ok((await mig({ parte: "productos", simular: true, reemplazar: true, filas: [{ ...comun, iva: 7 }] })).s === 400, "un IVA que no existe se rechaza");
ok((await llamar("POST", `/api/admin/clientes/10000000-0000-4000-8000-00000000000a/migracion`, { parte: "clientes", simular: true, filas: clientes }, adm)).s === 404, "la demo no se migra");

// ── Simular no cambia nada
const sc = await mig({ parte: "clientes", simular: true, filas: clientes });
const sp = await mig({ parte: "productos", simular: true, reemplazar: true, filas: productos });
ok(sc.s === 200 && sc.j.simulado && sc.j.resumen.crear === clientes.length, "simular clientes dice cuántos se crean", JSON.stringify(sc.j).slice(0, 200));
ok(sp.s === 200 && sp.j.resumen.unidades === conStock.reduce((a, p) => a + p.unidades, 0) && sp.j.resumen.en_cero === 1, "simular productos dice las existencias finales y lo que queda en cero", JSON.stringify(sp.j.resumen ?? sp.j));
ok(JSON.stringify(await fotos()) === JSON.stringify(antes), "simular no deja rastro en la base", JSON.stringify(await fotos()));

// ── Aplicar
const t0 = Date.now();
const rc = await mig({ parte: "clientes", simular: false, filas: clientes });
const rpv = await mig({ parte: "proveedores", simular: false, filas: proveedores });
const rp = await mig({ parte: "productos", simular: false, reemplazar: true, filas: productos });
ok(rc.s === 200 && rpv.s === 200 && rp.s === 200, "clientes, proveedores y productos se aplican", `${rc.s} ${rpv.s} ${rp.s} ${JSON.stringify(rp.j).slice(0, 300)}`);
let hv = { historial_nuevas: 0, cartera_nuevas: 0, saldo_cartera: 0, sin_cliente: 0 };
for (let i = 0; i < ventas.length; i += 250) {
  const r = await mig({ parte: "ventas", simular: false, filas: ventas.slice(i, i + 250) });
  if (r.s !== 200) { ok(false, `ventas lote ${i}`, JSON.stringify(r.j)); break; }
  for (const k of Object.keys(hv)) hv[k] += r.j.resumen[k];
}
console.log(`  (aplicado en ${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// Inventario: igual a Alegra, producto por producto
const quedo = await q(`select p.externo_id, p.nombre, p.precio_caja::int, p.iva::int, p.activo, coalesce(sum(s.unidades), 0)::int u, coalesce(sum(s.unidades * lc.costo_unidad), 0)::float valor,
    string_agg(s.lote, ',') lotes, max(s.vence)::text vence
  from productos p left join v_stock_lotes s on s.producto_id = p.id and s.unidades <> 0 left join lote_costos lc on lc.lote_id = s.lote_id
  where p.empresa_id = $1 group by p.id`, [E]);
const porExt = new Map(quedo.filter((x) => x.externo_id).map((x) => [x.externo_id, x]));
const malos = productos.filter((p) => { const x = porExt.get(p.externo_id); return !x || x.u !== p.unidades || x.precio_caja !== p.precio_caja || x.iva !== p.iva || (p.unidades > 0 && (x.lotes !== p.lote.toUpperCase() || x.vence !== p.vence)); });
ok(porExt.size === productos.length && malos.length === 0, `los ${productos.length} productos de Alegra quedan con sus existencias, lote, vencimiento, precio e IVA`, malos.slice(0, 3).map((p) => `${p.nombre}: ${JSON.stringify(porExt.get(p.externo_id))} vs ${p.unidades} ${p.lote} ${p.precio_caja}`).join(" | "));
const unidades = quedo.reduce((a, x) => a + x.u, 0), valor = Math.round(quedo.reduce((a, x) => a + x.valor, 0));
const esperado = Math.round(conStock.reduce((a, p) => a + p.unidades * p.costo_unidad, 0));
ok(unidades === conStock.reduce((a, p) => a + p.unidades, 0) && valor === esperado, `inventario total = Alegra: ${unidades} unidades, valor a costo $${valor.toLocaleString("es-CO")}`, `esperado $${esperado}`);
ok(quedo.find((x) => x.nombre === "PRODUCTO QUE ALEGRA NO TIENE")?.u === 0, "lo que Alegra no tiene queda en cero");
const c1 = quedo.find((x) => x.externo_id === comun.externo_id);
ok((await q(`select count(*)::int n from productos where empresa_id = $1 and lower(nombre) = lower($2)`, [E, comun.nombre]))[0].n === 1 && c1.lotes === comun.lote.toUpperCase(), "el producto que ya existía se reconoce por el nombre (no se duplica) y su lote viejo queda en cero");
const aj = await q(`select a.numero, a.motivo, a.detalle, count(l.*)::int lineas from ajustes a join ajuste_lineas l on l.ajuste_id = a.id where a.empresa_id = $1 group by a.id`, [E]);
ok(aj.length === 1 && aj[0].motivo === "conteo" && /Migración desde Alegra/.test(aj[0].detalle) && aj[0].lineas === 2, "lo que sobraba sale con UN ajuste numerado («Migración desde Alegra»)", JSON.stringify(aj));
const vencidos = productos.filter((p) => p.unidades > 0 && p.vence < new Date().toISOString().slice(0, 10)).length;
const mov = await q(`select tipo, count(*)::int n from movimientos where empresa_id = $1 and creado > now() - interval '10 minutes' group by 1 order by 1`, [E]);
ok(mov.find((m) => m.tipo === "inicial")?.n === conStock.length - vencidos + 2 && mov.find((m) => m.tipo === "ajuste")?.n === vencidos + 2, "cada lote de Alegra entra como inventario inicial con su costo (los ya vencidos, como ajuste)", JSON.stringify(mov) + ` vencidos ${vencidos}`);

// Clientes y proveedores
const cl = (await q(`select count(*)::int n, count(direccion)::int dir, count(email)::int correo from clientes where empresa_id = $1`, [E]))[0];
ok(cl.n === antes.clientes + clientes.length && cl.dir === clientes.filter((c) => c.direccion).length, `${clientes.length} clientes con dirección y correo`, JSON.stringify(cl));
ok((await q(`select count(*)::int n from proveedores where empresa_id = $1`, [E]))[0].n === antes.proveedores + proveedores.length, `${proveedores.length} proveedores`);

// Historial y cartera
const porCobrar = ventas.filter((v) => v.estado === "por_cobrar");
const saldo = porCobrar.reduce((a, v) => a + v.saldo, 0);
ok(hv.historial_nuevas === ventas.length && hv.sin_cliente === 0, `historial: ${ventas.length} documentos, todos con su cliente`, JSON.stringify(hv));
const h = (await q(`select count(*)::int n, sum(total) filter (where estado <> 'anulada')::float total, sum(jsonb_array_length(lineas))::int lineas from ventas_externas where empresa_id = $1`, [E]))[0];
ok(h.total === ventas.filter((v) => v.estado !== "anulada").reduce((a, v) => a + v.total, 0) && h.lineas === ventas.reduce((a, v) => a + v.lineas.length, 0), `vendido en Alegra $${h.total.toLocaleString("es-CO")} en ${h.lineas} líneas`);
ok(hv.cartera_nuevas === porCobrar.length && hv.saldo_cartera === saldo, `cartera: ${porCobrar.length} facturas por $${saldo.toLocaleString("es-CO")}`, JSON.stringify(hv));
const vc = (await q(`select count(*)::int n, sum(saldo)::float s from v_cartera vc where vc.empresa_id = $1 and saldo > 0`.replace("from v_cartera vc", "from (select v.id, v.total - coalesce((select sum(valor) from abonos a where a.venta_id = v.id and not a.anulado), 0) saldo, v.empresa_id from ventas v where v.condicion = 'credito' and v.origen = 'alegra') vc"), [E]))[0];
ok(vc.n === porCobrar.length && vc.s === saldo, "la cartera en la base cuadra con Alegra");
const venc = await q(`select v.prefijo || v.numero n, v.vence_pago::text from ventas v where v.empresa_id = $1 and v.origen = 'alegra'`, [E]);
ok(venc.every((x) => x.vence_pago === porCobrar.find((y) => `${y.prefijo}${y.numero}` === x.n)?.vence), "cada factura por cobrar vence el mismo día que en Alegra", JSON.stringify(venc));
ok((await q(`select count(*)::int n from documentos_dian where empresa_id = $1`, [E]))[0].n === 0 && (await q(`select count(*)::int n from ventas where empresa_id = $1 and caja_id is not null and origen is not null`, [E]))[0].n === 0, "nada de Alegra va a la DIAN ni a la caja");

// ── Repetir no duplica nada
const f1 = await fotos();
const rp2 = await mig({ parte: "productos", simular: false, reemplazar: true, filas: productos });
const rc2 = await mig({ parte: "clientes", simular: false, filas: clientes });
await mig({ parte: "proveedores", simular: false, filas: proveedores });
const rv2 = await mig({ parte: "ventas", simular: false, filas: ventas.slice(0, 250) });
ok(rp2.j.resumen?.crear === 0 && rp2.j.resumen.lotes_nuevos === 0 && rp2.j.cambios.length === 0 && rc2.j.resumen.crear === 0 && rv2.j.resumen.historial_nuevas === 0, "repetir la migración no cambia nada", JSON.stringify([rp2.j.resumen, rc2.j.resumen, rv2.j.resumen]));
ok(JSON.stringify(await fotos()) === JSON.stringify(f1), "la base queda igual tras repetir", `${JSON.stringify(f1)} → ${JSON.stringify(await fotos())}`);
// Alegra cambió (vendieron 1 unidad): la migración otra vez deja la nueva cifra con otro ajuste.
const cambiado = productos.map((p) => p.externo_id === comun.externo_id ? { ...p, unidades: p.unidades - 1 } : p);
const rp3 = await mig({ parte: "productos", simular: false, reemplazar: true, filas: cambiado });
ok(rp3.j.cambios?.length === 1 && rp3.j.cambios[0].despues === comun.unidades - 1, "si Alegra cambió, volver a migrar ajusta solo esa diferencia", JSON.stringify(rp3.j.cambios));

// ── En la aplicación (como el dueño)
const ventaAlegra = (await q(`select id, prefijo || numero n, total::float from ventas where empresa_id = $1 and origen = 'alegra' order by total desc limit 1`, [E]))[0];
ok((await q(`update ventas set estado = 'anulada' where id = $1`, [ventaAlegra.id]).then(() => false, (e) => /viene de Alegra/.test(e.message))), "una factura de Alegra no se anula en Regenta");
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": IP } });
const [nom, val] = adm.split("=");
await ctx.addCookies([{ name: nom, value: val, url: B }]);
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const ent = await p.request.post(`${B}/api/admin/clientes/${E}/entrar`, { headers: { origin: B } });
ok(ent.ok(), "la consola entra como el dueño");
await p.goto(B + "/cartera");
ok(await p.getByText(ventaAlegra.n).count() >= 1 || (await p.content()).includes(String(Math.round(saldo)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")), "la cartera muestra lo que quedó por cobrar en Alegra");
await p.goto(`${B}/ventas/${ventaAlegra.id}`);
await p.waitForURL(/\/ventas\/historial\//);
ok(await p.getByText(/se hizo en Alegra/).count() === 1 && await p.getByText(/Saldo por cobrar/).count() === 1, "la venta de Alegra abre su detalle con el saldo de la cartera");
const ab = await p.request.post(`${B}/api/cartera`, { headers: { origin: B }, data: { venta_id: ventaAlegra.id, medio: "transferencia", valor: 100000, idem_key: crypto.randomUUID() } });
ok(ab.status() === 201, "se recibe un abono a una factura de Alegra", `${ab.status()} ${await ab.text()}`);
await p.reload();
ok(await p.getByText(pesosTexto(ventaAlegra.total - 100000)).count() >= 1, "el saldo baja con el abono");
await p.goto(`${B}/ventas/historial?q=${encodeURIComponent(ventas.at(-1).cliente_nombre.split(" ")[0])}`);
ok(await p.locator("tbody a", { hasText: `${ventas.at(-1).prefijo}${ventas.at(-1).numero}` }).count() === 1, "el historial busca por cliente", p.url() + " " + (await p.locator("main").innerText()).slice(0, 400));
await p.goto(`${B}/ventas/historial?q=${encodeURIComponent(ventas.at(-1).lineas[0].nombre.split(" ")[0])}`);
ok(await p.locator("tbody tr").count() >= 1 && await p.getByText(/Nada coincide/).count() === 0, "el historial busca por producto");
const dia = ventas.find((v) => v.estado === "por_cobrar").fecha_hora.slice(0, 10);
await p.goto(`${B}/ventas?dia=${dia}`);
ok(await p.getByText(/Historial de Alegra/).count() >= 1 && await p.locator("tbody a", { hasText: "POSF" }).count() === 0, "las ventas del día no mezclan Alegra y enlazan al historial");
const rep = await (await p.request.get(`${B}/api/reportes?desde=${dia}&hasta=${dia}`)).json().catch(() => null);
ok(!rep || JSON.stringify(rep).includes('"ventas":0') || !JSON.stringify(rep).includes(String(porCobrar[0].saldo)), "los informes de Regenta no cuentan las ventas de Alegra", JSON.stringify(rep).slice(0, 200));
const cid = (await q(`select cliente_id from ventas where id = $1`, [ventaAlegra.id]))[0].cliente_id;
await p.goto(`${B}/clientes/${cid}`);
ok(/Compras en Alegra \(1/.test(await p.locator(`a[href="/ventas/historial?cliente=${cid}"]`).first().innerText().catch(() => "")), "la ficha del cliente enlaza sus compras en Alegra", p.url() + " " + (await p.locator("main").innerText()).slice(0, 400));
await p.goto(`${B}/inventario?ver=todos&q=${encodeURIComponent(comun.nombre.split(" ")[0])}`);
ok(await p.getByText(comun.lote.toUpperCase()).count() >= 1, "el inventario muestra el lote de Alegra");
// La consola: subir el archivo, simular y aplicar (ya estaba aplicado: no cambia nada).
const f2 = await fotos();
await p.goto(`${B}/admin/clientes/${E}`);
await p.locator('[data-prueba="archivo-migracion"]').setInputFiles(path.join(DIR, "migracion-farmagenericos.json"));
await p.getByText(/872 productos/).waitFor();
ok(await p.getByRole("button", { name: "Aplicar migración" }).isDisabled(), "no se aplica sin simular antes");
await p.getByRole("button", { name: "Simular" }).click();
await p.getByText("Simulación (no se ha cambiado nada)").waitFor({ timeout: 60000 });
ok(await p.getByText("Historial de ventas y cartera").count() === 1, "la consola simula las cuatro partes", (await p.locator('[role="status"]').innerText()).slice(0, 400));
await p.getByRole("button", { name: "Aplicar migración" }).click();
await p.getByText("Migración aplicada").waitFor({ timeout: 120000 });
const txt = await p.locator('[role="status"]').innerText();
ok(/6 sin cambios/.test(txt) && /\$51\.881\.934 valor a costo/.test(txt) && /8\.670 unidades finales/.test(txt) && /1\.035 ya estaban/.test(txt), "la consola aplica y muestra el inventario y el historial de Alegra", txt.slice(0, 500));
const f3 = await fotos();
ok(f3.productos === f2.productos && f3.clientes === f2.clientes && f3.historial === f2.historial && f3.ventas === f2.ventas, "aplicar desde la consola sobre lo ya migrado no duplica nada", `${JSON.stringify(f2)} → ${JSON.stringify(f3)}`);
ok(errs.length === 0, "sin errores en las páginas", errs.join(" | "));
await b.close();

// Limpieza: VECINA vuelve a quedar sin datos (borrado de empresa de prueba no aplica: se deja, db-reset la recrea)
await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
function pesosTexto(n) { return "$" + Math.round(n).toLocaleString("es-CO"); }
