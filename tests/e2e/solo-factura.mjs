// Droguería que factura en producción pero con el POS en pruebas (Farmagenéricos: solo factura electrónica): la caja
// no ofrece tiquete POS, el servidor no acepta ventas POS (no valdrían ante la DIAN) y la factura sí sale.
// Uso: servidor en :4540 (REGENTA_DEMO=1) → node tests/e2e/solo-factura.mjs  (usa la demo con demo=false mientras corre)
import { chromium } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4540";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && !/status of 4(00|09|22)/.test(m.text()) && errs.push(m.text()));
await p.goto(B + "/entrar");
await p.getByRole("button", { name: /Carlos/ }).click();
await p.waitForURL(/\/(caja|inicio)/);
const emp = (await q(`select id from empresas where demo limit 1`))[0].id;

// Estado de Farmagenéricos: factura y nota crédito en producción, POS en pruebas.
const antes = await q(`select id, activa from resoluciones_dian where empresa_id = $1`, [emp]);
await q(`update empresas set demo = false where id = $1`, [emp]);
try {
  await q(`update resoluciones_dian set activa = false where empresa_id = $1 and tipo in ('factura', 'nota_credito')`, [emp]);
  await q(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, pruebas, numero_resolucion, vigente_desde, vigente_hasta)
    values ($1, 'factura', 'FGX', 1, 5000, 0, false, '18764118389325', current_date, current_date + 730), ($1, 'nota_credito', 'NCX', 1, 5000, 0, false, null, null, null)`, [emp]);
  const posReal = (await q(`select 1 from resoluciones_dian where empresa_id = $1 and activa and tipo = 'pos' and not pruebas`, [emp])).length;
  ok(posReal === 0, "el POS sigue en pruebas");

  await p.goto(B + "/caja");
  await p.locator("#buscar").waitFor();
  ok(await p.getByText(/no tiene tiquete POS habilitado/).count() === 1, "la caja dice que esta droguería solo factura");
  ok(await p.getByRole("button", { name: "Tiquete POS" }).count() === 0, "no ofrece el tiquete POS");
  ok(await p.getByText(/aún no está habilitada ante la DIAN/).count() === 0, "no dice que la droguería no está habilitada (ya factura)");
  ok(await p.getByLabel(/Cliente de la factura|NIT, cédula o nombre/).count() >= 1 || await p.getByPlaceholder(/NIT, cédula o nombre/).count() >= 1, "pide el cliente de la factura desde el principio");

  const prod = (await (await p.request.get(B + "/api/productos?q=acetaminofen")).json()).productos.find((x) => x.unidades > 5);
  const pos = await p.request.post(B + "/api/ventas", { headers: { origin: B }, data: { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 100000 }] } });
  const jp = await pos.json().catch(() => ({}));
  ok(pos.status() >= 400 && pos.status() < 500 && /solo con factura electrónica/.test(jp.error ?? ""), "el servidor no acepta un tiquete POS (no valdría ante la DIAN)", `${pos.status()} ${jp.error}`);

  const cli = (await (await p.request.get(B + "/api/clientes?q=salud")).json()).clientes?.[0];
  const fv = await (await p.request.post(B + "/api/ventas", { headers: { origin: B }, data: { idem_key: crypto.randomUUID(), tipo_doc: "factura", cliente_id: cli?.id, lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 100000 }] } })).json();
  ok(fv.venta?.prefijo === "FGX" && fv.venta?.numero === 1, "la factura sale con la numeración de producción", JSON.stringify(fv).slice(0, 200));

  // La página de inicio ya no pide la habilitación DIAN (factura en producción cuenta como habilitada)
  await p.goto(B + "/inicio");
  const paso = p.getByRole("link", { name: /Habilitación DIAN/ });
  ok(!(await paso.count()) || /\(hecho\)/.test(await paso.first().textContent()), "Primeros pasos da por hecha la habilitación DIAN", await paso.count() ? await paso.first().textContent() : "sin primeros pasos");
  ok(errs.length === 0, "sin errores de consola", errs.join(" | "));
} finally {
  await q(`delete from resoluciones_dian where empresa_id = $1 and prefijo in ('FGX', 'NCX') and not exists (select 1 from documentos_dian d where d.empresa_id = $1 and d.prefijo = resoluciones_dian.prefijo)`, [emp]).catch(() => {});
  await q(`update resoluciones_dian set activa = false where empresa_id = $1 and prefijo in ('FGX', 'NCX')`, [emp]).catch(() => {});
  for (const r of antes) await q(`update resoluciones_dian set activa = $2 where id = $1`, [r.id, r.activa]);
  await q(`update empresas set demo = true where id = $1`, [emp]);
}
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
