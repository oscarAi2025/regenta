// Reportes con datos reales (11/11/2026: «ganancia −$561 millones» por un costo de caja escrito como costo por unidad):
//  · el formulario de producto pone el costo por caja o por unidad y no deja un costo por unidad que no cuadra con el precio;
//  · un costo que no cuadra no entra en la ganancia: se avisa y se corrige desde el reporte (queda en la auditoría);
//  · el reporte por producto dice las cajas; el historial por fechas muestra las ventas de Regenta;
//  · en la caja se cambia el precio de una línea antes de cobrar y la base cobra exactamente ese precio.
// Uso: servidor con REGENTA_DEMO=1 y la base recién sembrada → node tests/e2e/reportes-costos.mjs
import { chromium } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const num = (t) => Number(String(t).replace(/[^\d]/g, ""));
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
async function entrar(quien, o = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(o); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const api = (p, url, metodo = "GET", cuerpo) => p.evaluate(async ([u, m, c]) => {
  const r = await fetch(u, { method: m, headers: c === undefined ? {} : { "content-type": "application/json" }, body: c === undefined ? undefined : JSON.stringify(c) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}, [url, metodo, cuerpo]);
const q = async (sql, v = []) => (await pool.query(sql, v)).rows;
const enDias = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const sufijo = Date.now().toString(36).slice(-5).toUpperCase();
const NOMBRE = `Bajalenguas costo ${sufijo} caja x 500 unidades`;
const base = { nombre: NOMBRE, iva: 0, unidades_por_caja: 500, precio_caja: 36850, precio_unidad: 100, stock_minimo: 0 };

{
  const { ctx, p, errs } = await entrar("Carlos");

  // ── Servidor: un costo por unidad que no cuadra con el precio no entra
  const malo = await api(p, "/api/productos", "POST", { ...base, existencia: { lote: "C1", vence: enDias(300), unidades: 18000, costo_unidad: 31280 } });
  ok(malo.status === 422 && /costo de la caja/.test(malo.j.error ?? ""), "el servidor no acepta $31.280 por unidad en una caja x 500 de $36.850", `${malo.status} ${malo.j.error}`);
  ok((await q(`select count(*)::int n from productos where nombre = $1`, [NOMBRE]))[0].n === 0, "y el producto no queda a medias");
  const bien = await api(p, "/api/productos", "POST", { ...base, existencia: { lote: "C1", vence: enDias(300), unidades: 18000, costo_unidad: 62.56 } });
  ok(bien.status === 201, "con $62,56 por unidad sí entra", `${bien.status} ${JSON.stringify(bien.j)}`);
  const pid = bien.j.id;

  // ── Formulario: costo por caja o por unidad, con aviso
  await p.goto(B + `/productos/${pid}`); await p.waitForLoadState("networkidle");
  await p.fill("#ex-lote", "C2"); await p.fill("#ex-vence", enDias(200)); await p.fill("#ex-unidades", "500"); await p.fill("#ex-costo", "31280");
  ok(await p.getByText(/es mucho mayor que el precio de venta por unidad/).isVisible(), "el formulario avisa que $31.280 por unidad no cuadra");
  await p.getByRole("button", { name: "Es el costo de la caja" }).click();
  ok(await p.getByText("Costo por caja sin IVA").isVisible() && await p.getByText(/= \$62,56 por unidad/).isVisible(), "un clic lo pasa a costo por caja: = $62,56 por unidad");
  await Promise.all([p.waitForURL(/\/productos$/), p.getByRole("button", { name: /Guardar/ }).click()]);
  const [c2] = await q(`select lc.costo_unidad::float c from lotes l join lote_costos lc on lc.lote_id = l.id where l.producto_id = $1 and l.lote = 'C2'`, [pid]);
  ok(Math.abs((c2?.c ?? 0) - 62.56) < 0.001, "el lote C2 quedó con $62,56 por unidad", JSON.stringify(c2));

  // ── Datos viejos con el costo de la caja como costo por unidad: el reporte no se descuadra
  await q(`update lote_costos set costo_unidad = 31280 where lote_id = (select id from lotes where producto_id = $1 and lote = 'C1')`, [pid]);
  await q(`update lotes set vence = $2 where producto_id = $1 and lote = 'C2'`, [pid, enDias(400)]); // que salga primero el lote C1
  const v = await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: pid, presentacion: "caja", cantidad: 2 }], pagos: [{ medio: "efectivo", valor: 80000 }] });
  ok(v.status === 200, "venta de 2 cajas", `${v.status} ${v.j.error ?? ""}`);
  await p.goto(B + `/reportes?desde=${hoy}&hasta=${hoy}`); await p.waitForLoadState("networkidle");
  const card = await p.locator('[aria-label="Resumen"]').innerText();
  ok(!/−\$\d{1,3}\.\d{3}\.\d{3}/.test(card) && /con costo por revisar \(no cuentan\)/.test(card), "la ganancia no se hunde en millones: lo vendido con costo por revisar va aparte", card.replace(/\n/g, " ").slice(0, 300));
  const aviso = p.locator('section[aria-labelledby="revisar-t"]');
  ok(await aviso.isVisible() && /\$31\.280 por unidad/.test(await aviso.innerText()), "aviso «Costos que no cuadran» con el costo registrado");
  const fila = p.locator('[aria-label="Por producto"] tr').filter({ hasText: NOMBRE });
  ok(/1\.000 und · 2 cajas/.test(await fila.innerText()) && /costo por revisar/.test(await fila.innerText()), "por producto: «1.000 und · 2 cajas» y costo por revisar", await fila.innerText());
  await aviso.getByRole("button", { name: /Era el costo de la caja/ }).click();
  await aviso.getByText("Costo corregido").waitFor();
  await p.reload(); await p.waitForLoadState("networkidle");
  ok(await p.locator('section[aria-labelledby="revisar-t"]').count() === 0, "corregido: el aviso desaparece");
  const g = await p.locator('[aria-label="Por producto"] tr').filter({ hasText: NOMBRE }).locator("td").last().innerText();
  ok(num(g) > 0 && !g.includes("−"), "y la ganancia del producto es real y positiva", g);
  const [lc] = await q(`select lc.costo_unidad::float c from lotes l join lote_costos lc on lc.lote_id = l.id where l.producto_id = $1 and l.lote = 'C1'`, [pid]);
  ok(Math.abs(lc.c - 62.56) < 0.001, "el lote C1 quedó con $62,56 por unidad", JSON.stringify(lc));
  const [au] = await q(`select datos from auditoria where accion = 'corregir_costo' order by id desc limit 1`);
  ok(au?.datos?.antes === 31280 && Math.abs(au.datos.despues - 62.56) < 0.001 && /caja/.test(au.datos.motivo), "la corrección queda en la auditoría con antes, después y motivo", JSON.stringify(au?.datos));
  await p.goto(B + `/bitacora`); await p.waitForLoadState("networkidle");
  ok(await p.getByText("Costo de un lote corregido").first().isVisible(), "y se ve en la bitácora");
  const otra = await api(p, "/api/inventario/costos", "PATCH", { lote_id: (await q(`select id from lotes where producto_id = $1 and lote = 'C1'`, [pid]))[0].id, costo_unidad: 70, motivo: "x" });
  ok(otra.status === 400, "sin motivo no se corrige un costo", String(otra.status));

  // ── Alegra y Regenta suman en el total real del rango
  const emp = (await q(`select empresa_id from productos where id = $1`, [pid]))[0].empresa_id;
  await q(`insert into ventas_externas (empresa_id, origen, externo_id, documento, prefijo, numero, fecha, cliente_nombre, subtotal, iva, total, pagado, saldo, estado, forma_pago, lineas)
    values ($1, 'alegra', $2, 'pos', 'POSF', 99001, $3::date, 'DISTRIBUIDORA PRUEBA', 1000000, 0, 1000000, 1000000, 0, 'pagada', 'transferencia',
      $4::jsonb)`, [emp, "t" + sufijo, hoy, JSON.stringify([{ nombre: NOMBRE, cantidad: 3, precio: 333333.33, total: 1000000 }])]);
  await p.goto(B + `/reportes?desde=${hoy}&hasta=${hoy}`); await p.waitForLoadState("networkidle");
  const resumen = await p.locator('[aria-label="Resumen"]').innerText();
  const regenta = (await q(`select coalesce(sum(total), 0)::float t from ventas where empresa_id = $1 and estado = 'cerrada' and (creado at time zone 'America/Bogota')::date = $2::date`, [emp, hoy]))[0].t
    - (await q(`select coalesce(sum(total), 0)::float t from devoluciones where empresa_id = $1 and (creado at time zone 'America/Bogota')::date = $2::date`, [emp, hoy]))[0].t;
  const esperado = Math.round(regenta + 1000000);
  ok(num(resumen.split("\n").find((l) => /^\$/.test(l))) === esperado && /Alegra \$1\.000\.000/.test(resumen), "«Ventas netas» = Regenta + Alegra", `${resumen.split("\n").slice(0, 4).join(" | ")} · esperado ${esperado}`);
  ok(/Incluye \$1\.000\.000 vendidos en Alegra/.test(await p.locator("main").innerText()), "y lo dice: incluye lo vendido en Alegra");
  const filaA = await p.locator('[aria-label="Por producto"] tr').filter({ hasText: NOMBRE }).innerText();
  ok(/3 en Alegra/.test(filaA), "el producto suma lo vendido en Alegra", filaA.replace(/\s+/g, " "));

  // ── Historial por fechas: también las ventas de Regenta
  await p.goto(B + `/ventas/historial?desde=${hoy}&hasta=${hoy}`); await p.waitForLoadState("networkidle");
  const rg = p.locator('section[aria-labelledby="regenta-t"]');
  ok(await rg.isVisible() && (await rg.innerText()).includes(`${v.j.venta.prefijo ?? ""}${v.j.venta.numero}`), "el historial de hoy muestra la venta de Regenta", (await rg.innerText().catch(() => "")).slice(0, 200));
  await p.goto(B + `/ventas/historial?q=${encodeURIComponent("bajalenguas costo " + sufijo)}`); await p.waitForLoadState("networkidle");
  ok(/1 venta\b/.test(await p.locator('section[aria-labelledby="regenta-t"]').innerText()), "y la encuentra por el producto");
  ok(errs.length === 0, "sin errores de JavaScript", errs.join(" | "));
  await ctx.close();
}

// ── Caja: cambiar el precio de una línea antes de cobrar (la cajera, dentro de su tope)
{
  const { ctx, p, errs } = await entrar("Laura");
  if (!p.url().endsWith("/caja")) await p.goto(B + "/caja");
  await p.waitForLoadState("networkidle");
  await p.keyboard.type("acetaminofen forte mk"); await p.waitForSelector('[aria-label="Resultados"] [role="option"]'); await p.keyboard.press("Enter");
  const aside = p.locator('aside[aria-label="Venta actual"]');
  const precio = num(await aside.getByRole("button", { name: /Cambiar el precio/ }).innerText());
  const nuevo = Math.round(precio * 0.95 / 10) * 10 + 7; // un precio «raro» (no sale de un % redondo)
  await aside.getByRole("button", { name: "Cambiar precio" }).click();
  const campo = aside.getByLabel(/^Precio de /);
  await campo.fill(String(nuevo)); await campo.press("Enter");
  const total = num(await aside.getByText(/^\$[\d.]+$/).last().textContent());
  ok(total === nuevo, "la caja muestra el precio escrito como total de la línea", `${total} = ${nuevo} (lista ${precio})`);
  await aside.getByRole("button", { name: "Cambiar precio" }).click();
  await aside.getByLabel(/^Precio de /).fill(String(precio + 1000)); await aside.getByLabel(/^Precio de /).press("Enter");
  ok(await aside.getByText(/Para cobrar más de/).isVisible(), "no deja subir el precio desde la caja (eso se cambia en el producto)");
  await aside.getByLabel(/^Precio de /).press("Escape");
  await p.keyboard.press("F9"); await p.waitForSelector("#recibido"); await p.fill("#recibido", "100000");
  await p.getByRole("button", { name: /Confirmar/ }).click();
  await p.getByText(/Nueva venta/).waitFor();
  const [vt] = await q(`select total::float t from ventas order by creado desc limit 1`);
  ok(vt.t === nuevo, "la base cobra exactamente el precio escrito", `${vt.t} = ${nuevo}`);
  ok(errs.length === 0, "sin errores de JavaScript (caja)", errs.join(" | "));
  await ctx.close();
}

await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
