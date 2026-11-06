// Mostrador ágil: cantidad escrita (clic en el número) y «12*» antes de escanear; la venta en curso sobrevive a una
// recarga; F4 pone en espera y F6 recupera intacta; una espera de la caja 1 se cobra en la caja 2; domicilio «en camino»
// → cobrar (venta, documento DIAN y existencias correctas) y aviso «en domicilios abiertos»; cancelar no mueve
// existencias; doble cobro del mismo pedido → solo uno; cotización del vendedor → imprimir → convertir con aviso de precio
// cambiado; vendedor invitado ve Pedidos y no la Caja, cobrar → 403; aislamiento entre empresas; celular sin desbordes;
// sin errores de consola. Capturas en test-results/mostrador.
// Uso: servidor con la base sembrada → BASE=http://localhost:4512 DATABASE_URL=… REGENTA_SESSION_SECRET=… node tests/e2e/mostrador.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { SignJWT } from "jose";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results/mostrador";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
const SECRETO = process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef";
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

const vigilar = (p) => { const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text())); return errs; };
const ESCRITORIO = { viewport: { width: 1440, height: 900 } };
async function entrar(quien, opciones = ESCRITORIO) {
  const ctx = await b.newContext(opciones);
  const p = await ctx.newPage();
  const errs = vigilar(p);
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
/** Sesión firmada para un usuario que no es de la demo (como haría /api/acceso tras la contraseña). */
async function sesionDe(s, opciones = ESCRITORIO) {
  const jwt = await new SignJWT({ ...s, v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(SECRETO));
  const ctx = await b.newContext(opciones);
  await ctx.addCookies([{ name: "regenta_sesion", value: jwt, url: B }]);
  const p = await ctx.newPage();
  return { ctx, p, errs: vigilar(p) };
}
const ir = async (p, ruta) => { await p.goto(B + ruta); await p.waitForLoadState("networkidle"); };
const api = async (p, url, metodo = "GET", cuerpo) => {
  const r = await p.evaluate(async ([u, m, c]) => {
    const r = await fetch(u, { method: m, headers: c === undefined ? {} : { "content-type": "application/json" }, body: c === undefined ? undefined : JSON.stringify(c) });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  }, [url, metodo, cuerpo]);
  if (r.status >= 400) p.__provocados = (p.__provocados ?? 0) + 1;
  return r;
};
const sinProvocados = (p, errs) => { let n = p.__provocados ?? 0; return errs.filter((e) => !(n > 0 && /Failed to load resource: the server responded with a status of 4\d\d/.test(e) && n--)); };
const q1 = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
const stock = async (prod) => Number((await q1(`select coalesce(sum(unidades), 0) u from v_stock_lotes where producto_id = $1`, [prod])).u);
const desborde = (p) => p.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - screen.width);
const cortados = (p) => p.evaluate(() => [...document.querySelectorAll("main *, [role=dialog] *")].filter((el) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.right <= screen.width + 1) return false;
  for (let a = el.parentElement; a; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return false;
  return true;
}).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} (${Math.round(el.getBoundingClientRect().right)}px)`));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const E = { A: "10000000-0000-4000-8000-00000000000a", B: "10000000-0000-4000-8000-00000000000b" };
const SEDE = (await q1(`select sede_id from cajas where empresa_id = $1 limit 1`, [E.A])).sede_id;
// Productos con margen: uno de unidad suelta con código de barras para «12*» y cuatro fraccionables con cientos de unidades.
const PS = await q1(`select p.id, p.nombre, p.ean, p.precio_caja::float precio from productos p where p.empresa_id = $1 and p.activo and p.ean is not null and p.unidades_por_caja = 1
    and not p.requiere_formula and (select count(*) from productos o where o.empresa_id = p.empresa_id and o.ean = p.ean) = 1
    and (select coalesce(sum(unidades), 0) from v_stock_vigente s where s.producto_id = p.id) >= 13 order by p.nombre limit 1`, [E.A]);
const FR = (await pool.query(`select p.id, p.nombre, p.unidades_por_caja upc, p.precio_caja::float pc, p.precio_unidad::float pu from productos p where p.empresa_id = $1 and p.activo and p.unidades_por_caja > 1
    and p.precio_unidad is not null and not p.requiere_formula and (select coalesce(sum(unidades), 0) from v_stock_vigente s where s.producto_id = p.id) >= 300
    and (select count(*) from productos o where o.empresa_id = p.empresa_id and lower(o.nombre) = lower(p.nombre)) = 1 order by p.nombre limit 4`, [E.A])).rows;
ok(!!PS && FR.length === 4, "hay productos con margen para la prueba", `${PS?.nombre} · ${FR.map((x) => x.nombre).join(" · ")}`);
const [PA, PB, PD, PC] = FR;

// La demo trae una caja: se agrega la segunda para cobrar desde otra computadora.
const C1 = (await q1(`select id from cajas where empresa_id = $1 and activa order by nombre, id limit 1`, [E.A])).id;
const C2 = (await q1(`insert into cajas (empresa_id, sede_id, nombre) values ($1, $2, 'Caja Mostrador E2E') returning id`, [E.A, SEDE])).id;
// Vendedor de la demo (para armar la cotización) y vendedor invitado en la Droguería Vecina (no es demo).
const VEND = "00000000-0000-4000-8000-0000000000e7";
await pool.query(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Valeria (vendedora)', 'vendedor') on conflict (empresa_id, user_id) do update set activo = true, rol = 'vendedor'`, [E.A, VEND]);

const L = await entrar("Laura");
const aside = L.p.locator('aside[aria-label="Venta actual"]');
const cantidad = (nombre) => aside.getByRole("button", { name: new RegExp(`^Cantidad de ${esc(nombre)}: \\d+`) });
const leerCant = async (nombre) => Number(((await cantidad(nombre).getAttribute("aria-label")) ?? "").match(/: (\d+)\./)?.[1]);
async function agregar(p, prod, unidad = false) {
  await p.locator("#buscar").fill(prod.nombre.slice(0, 45));
  const fila = p.locator('[aria-label="Resultados"] [role="option"]', { hasText: prod.nombre }).first();
  await fila.waitFor({ timeout: 10000 });
  if (unidad) await fila.getByRole("button", { name: /Unidad/ }).click(); else await fila.getByRole("button").first().click();
  await p.locator('aside[aria-label="Venta actual"] li', { hasText: prod.nombre }).first().waitFor();
}

// ───────────── 1) Cantidad escrita y «12*»
let espera1;
{
  const { p } = L;
  await ir(p, "/caja");
  await p.locator("#buscar").click();
  await p.keyboard.type("12*");
  await p.getByRole("status").filter({ hasText: /Cantidad: 12 para el siguiente producto/ }).waitFor({ timeout: 5000 });
  ok(await p.locator("#buscar").inputValue() === "", "«12*» deja la búsqueda limpia y avisa la cantidad");
  await p.keyboard.type(PS.ean); await p.keyboard.press("Enter");
  await aside.locator("li", { hasText: PS.nombre }).waitFor({ timeout: 10000 });
  ok(await leerCant(PS.nombre) === 12, "«12*» + escanear agrega 12 de una vez", String(await leerCant(PS.nombre)));
  await agregar(p, PA, true);
  await cantidad(PA.nombre).click();
  const campo = aside.getByLabel(`Cantidad de ${PA.nombre}`, { exact: true });
  await campo.fill("0"); await campo.press("Enter");
  ok(/mayor que cero/.test(await aside.getByRole("alert").first().textContent()), "cantidad 0 → error claro");
  await campo.fill("5000"); await campo.press("Enter");
  ok(/Máximo 1\.000/.test(await aside.getByRole("alert").first().textContent()), "cantidad exagerada → error con el máximo");
  await campo.fill("30"); await campo.press("Enter");
  await cantidad(PA.nombre).waitFor();
  ok(await leerCant(PA.nombre) === 30, "clic en el número y escribir 30 (sin 30 clics)");
  ok(await p.evaluate(() => document.activeElement?.id) === "buscar", "tras escribir la cantidad el foco vuelve al buscador");
  await p.screenshot({ path: `${OUT}/caja-cantidades-1440.png` });

  // ───────────── 2) Recargar a mitad de venta
  await p.reload(); await p.waitForLoadState("networkidle");
  await p.getByText("Recuperamos la venta que estaba en curso").waitFor({ timeout: 8000 });
  ok(await leerCant(PS.nombre) === 12 && await leerCant(PA.nombre) === 30, "al recargar la venta vuelve completa (12 y 30)");
  await p.screenshot({ path: `${OUT}/caja-recuperada-1440.png` });

  // ───────────── 3) F4 → venta nueva → F6 recupera la primera intacta
  await p.keyboard.press("F4");
  await p.getByRole("dialog").waitFor();
  await p.locator("#pd-contacto").fill("Señora de gorra roja");
  await p.locator("#pd-contacto").press("Enter");
  await p.getByRole("status").filter({ hasText: /Venta en espera N\.º \d+/ }).waitFor({ timeout: 10000 });
  ok(await p.getByText("Escanea o busca un producto para empezar").count() === 1, "F4 deja la caja libre para otra venta");
  espera1 = await q1(`select id, numero, contacto, estado, caja_id from pedidos_mostrador where empresa_id = $1 and tipo = 'espera' order by creado desc limit 1`, [E.A]);
  const lin = (await pool.query(`select producto_id, presentacion, cantidad from pedido_lineas where pedido_id = $1 order by id`, [espera1.id])).rows;
  ok(espera1.contacto === "Señora de gorra roja" && espera1.caja_id === C1 && lin.length === 2 && lin[0].cantidad === 12 && lin[1].cantidad === 30 && lin[1].presentacion === "unidad",
    "la espera queda en el servidor con nombre, caja y cantidades", JSON.stringify(lin));
  await agregar(p, PB, true);
  await p.keyboard.press("F6");
  await p.getByRole("dialog").waitFor();
  await p.getByRole("button", { name: `Recuperar En espera N.º ${espera1.numero}`, exact: true }).click();
  await aside.locator("li", { hasText: PS.nombre }).waitFor({ timeout: 10000 });
  ok(await leerCant(PS.nombre) === 12 && await leerCant(PA.nombre) === 30 && await aside.locator("li", { hasText: PB.nombre }).count() === 0, "F6 recupera la primera venta intacta");
  ok(await p.getByRole("status").filter({ hasText: /La venta que tenías quedó en espera N\.º \d+/ }).count() === 1, "la venta que estaba en la caja quedó en espera (no se pierde)");
  ok(await aside.getByLabel("Pedido en la caja").filter({ hasText: `En espera N.º ${espera1.numero}` }).count() === 1, "la tirilla muestra qué pedido está abierto");
  await p.screenshot({ path: `${OUT}/caja-espera-recuperada-1440.png` });
  // Se vuelve a dejar en espera para cobrarla desde otra caja (actualiza la misma espera).
  await p.keyboard.press("F4"); await p.getByRole("dialog").waitFor();
  ok(await p.locator("#pd-contacto").inputValue() === "Señora de gorra roja", "al volver a F4 conserva el nombre");
  await p.getByRole("button", { name: "Guardar en espera" }).click();
  await p.getByRole("status").filter({ hasText: new RegExp(`Venta en espera N\\.º ${espera1.numero}\\b`) }).waitFor({ timeout: 10000 });
  ok(Number((await q1(`select count(*) n from pedidos_mostrador where id = $1 and estado = 'abierto'`, [espera1.id])).n) === 1, "la misma espera se actualiza (no se duplica)");
}

// ───────────── 4) La espera de la caja 1 se cobra en la caja 2
{
  const D = await entrar("Carlos");
  await D.ctx.addCookies([{ name: "regenta_caja", value: C2, url: B }]);
  const { p } = D;
  const antesPS = await stock(PS.id), antesPA = await stock(PA.id);
  await ir(p, "/caja");
  ok(await p.getByLabel("Caja de esta computadora").inputValue() === C2, "la segunda computadora trabaja en «Caja Mostrador E2E»");
  await p.getByRole("button", { name: /^Recuperar( F6)?$/ }).click();
  await p.getByRole("button", { name: `Recuperar En espera N.º ${espera1.numero}`, exact: true }).click();
  const tir = p.locator('aside[aria-label="Venta actual"]');
  await tir.locator("li", { hasText: PS.nombre }).waitFor({ timeout: 10000 });
  await p.keyboard.press("F9"); await p.getByRole("button", { name: "Exacto" }).click();
  await p.getByRole("button", { name: /Confirmar/ }).click();
  await p.getByText("Venta registrada").waitFor({ timeout: 15000 });
  ok(await p.getByText(`En espera N.º ${espera1.numero} quedó cobrado`).count() === 1, "la caja 2 cobra la espera de la caja 1");
  const ped = await q1(`select pm.estado, v.caja_id, v.total::float total from pedidos_mostrador pm join ventas v on v.id = pm.venta_id where pm.id = $1`, [espera1.id]);
  ok(ped?.estado === "cobrado" && ped.caja_id === C2, "el pedido queda cobrado y la venta en la caja 2", JSON.stringify(ped));
  ok(antesPS - await stock(PS.id) === 12 && antesPA - await stock(PA.id) === 30, "las existencias bajan exactamente lo vendido (12 y 30)");
  await p.keyboard.press("Enter");
  ok(sinProvocados(p, D.errs).length === 0, "sin errores de consola (caja 2)", sinProvocados(p, D.errs).join(" | "));
  await D.ctx.close();
  // En la caja 1, la espera ya no aparece para recuperar.
  await L.p.keyboard.press("F6"); await L.p.getByRole("dialog").waitFor();
  await L.p.getByRole("list", { name: "Pedidos para recuperar" }).or(L.p.getByText("No hay ventas en espera")).first().waitFor();
  ok(await L.p.getByRole("button", { name: `Recuperar En espera N.º ${espera1.numero}`, exact: true }).count() === 0, "la espera cobrada ya no sale en la lista de la caja 1");
  await L.p.keyboard.press("Escape");
}

// ───────────── 5) Domicilio: rótulo, en camino, aviso en otras ventas, cobrar
let domi;
{
  const { p } = L;
  const auto = await q1(`select id, numero from pedidos_mostrador where empresa_id = $1 and tipo = 'espera' and estado = 'abierto' order by creado desc limit 1`, [E.A]); // la de PB que quedó en espera sola
  await ir(p, "/caja");
  if (await p.getByText("Recuperamos la venta").count()) await p.getByRole("button", { name: "Descartarla" }).click();
  const antes = await stock(PD.id);
  await agregar(p, PD, true);
  await cantidad(PD.nombre).click(); await aside.getByLabel(`Cantidad de ${PD.nombre}`, { exact: true }).fill("4"); await p.keyboard.press("Enter");
  await p.getByRole("button", { name: "Domicilio", exact: true }).click();
  await p.locator("#pd-contacto").fill("Pedro Pérez");
  await p.locator("#pd-telefono").fill("300 123 4567");
  await p.locator("#pd-direccion").fill("Cra 5 # 10-20, apto 301");
  await p.locator("#pd-nota").fill("Paga con billete de 50 mil");
  await p.screenshot({ path: `${OUT}/caja-domicilio-1440.png` });
  await p.getByRole("button", { name: "Guardar domicilio" }).click();
  await p.getByRole("dialog").getByRole("status").filter({ hasText: /Domicilio N\.º \d+ guardado/ }).waitFor({ timeout: 10000 });
  domi = await q1(`select id, numero from pedidos_mostrador where empresa_id = $1 and tipo = 'domicilio' order by creado desc limit 1`, [E.A]);
  const [rot] = await Promise.all([p.waitForEvent("frameattached").then(() => true, () => false), p.getByRole("button", { name: "Imprimir rótulo" }).click()]);
  ok(rot, "«Imprimir rótulo» manda el rótulo a la impresora");
  await p.getByRole("button", { name: /marcar en camino/ }).click();
  await p.getByRole("status").filter({ hasText: /guardado y en camino/ }).waitFor({ timeout: 10000 });
  ok((await q1(`select estado from pedidos_mostrador where id = $1`, [domi.id])).estado === "en_camino", "el domicilio queda «en camino»");
  ok(await stock(PD.id) === antes, "guardar el domicilio y despacharlo no mueve existencias");
  // Otra venta con el mismo producto avisa lo que va en domicilios abiertos (sin reservar).
  await agregar(p, PD, true);
  await aside.getByText(/4 und en domicilios abiertos/).waitFor({ timeout: 8000 }).catch(() => {});
  ok(await aside.getByText(/4 und en domicilios abiertos/).count() === 1, "la caja muestra «4 und en domicilios abiertos»");
  await aside.getByRole("button", { name: `Quitar ${PD.nombre}` }).click();
  // Rótulo imprimible
  const r = await L.ctx.newPage();
  await r.goto(`${B}/tiquete/cotizacion/${domi.id}`); await r.waitForLoadState("networkidle");
  const t = await r.locator("main").innerText();
  ok(/DOMICILIO N\.º \d+/.test(t) && t.includes("Pedro Pérez") && t.includes("Cra 5 # 10-20") && /Valor a cobrar/.test(t), "rótulo con cliente, dirección y valor a cobrar", t.slice(0, 160));
  await r.screenshot({ path: `${OUT}/rotulo-domicilio.png`, fullPage: true });
  await r.close();
  // Volvió el domiciliario: se cobra desde Pedidos
  await ir(p, "/pedidos?tipo=domicilio");
  const tarjeta = p.getByRole("listitem", { name: `Domicilio N.º ${domi.numero}`, exact: true });
  ok(await tarjeta.getByText("En camino").count() === 1, "Pedidos muestra el domicilio en camino");
  await p.screenshot({ path: `${OUT}/pedidos-1440.png`, fullPage: true });
  await Promise.all([p.waitForURL(/\/caja/), tarjeta.getByRole("link", { name: "Cobrar en la caja" }).click()]);
  await p.waitForLoadState("networkidle");
  await aside.locator("li", { hasText: PD.nombre }).waitFor({ timeout: 10000 });
  ok(await leerCant(PD.nombre) === 4, "el domicilio abre en la caja con sus cantidades");
  await p.keyboard.press("F9"); await p.getByRole("button", { name: "Exacto" }).click();
  await p.getByRole("button", { name: /Confirmar/ }).click();
  await p.getByText("Venta registrada").waitFor({ timeout: 15000 });
  const v = await q1(`select v.id, v.total::float total, v.estado, (select sum(unidades)::int from venta_lineas where venta_id = v.id) und, d.estado doc, d.tipo
    from pedidos_mostrador pm join ventas v on v.id = pm.venta_id join documentos_dian d on d.venta_id = v.id where pm.id = $1 and pm.estado = 'cobrado'`, [domi.id]);
  ok(v?.und === 4 && v.tipo === "pos" && v.doc === "aceptado" && v.total === 4 * PD.pu, "domicilio cobrado: venta, documento DIAN aceptado y total al precio vigente", JSON.stringify(v));
  ok(antes - await stock(PD.id) === 4, "las existencias bajan solo al cobrar (4 und)");
  await p.keyboard.press("Enter");
  // La espera que quedó sola (venta de PB) se cancela con motivo: no mueve existencias.
  if (auto) {
    const antesB = await stock(PB.id);
    await ir(p, "/pedidos?tipo=espera");
    const t2 = p.getByRole("listitem", { name: `En espera N.º ${auto.numero}`, exact: true });
    await t2.getByRole("button", { name: "Cancelar…" }).click();
    await t2.getByLabel("Motivo de la cancelación").fill("El cliente se fue");
    await t2.getByRole("button", { name: "Cancelar pedido" }).click();
    await t2.getByText("Cancelado", { exact: true }).waitFor({ timeout: 8000 });
    ok(await t2.getByText("Motivo: El cliente se fue").count() === 1, "cancelar con motivo actualiza la tarjeta sin recargar");
    ok(await stock(PB.id) === antesB, "cancelar no mueve existencias");
  } else ok(false, "quedó en espera la venta que estaba en la caja al recuperar");
}

// ───────────── 6) Cancelar un domicilio en camino no mueve existencias; doble cobro → solo uno
{
  const { p } = L;
  await ir(p, "/pedidos");
  const antes = await stock(PD.id);
  const d2 = await api(p, "/api/pedidos", "POST", { tipo: "domicilio", contacto: "Ana", telefono: "3009876543", direccion: "Calle 2 # 3-4", lineas: [{ producto_id: PD.id, presentacion: "unidad", cantidad: 2 }] });
  ok(d2.status === 201, "API: crea un domicilio", String(d2.status));
  await api(p, `/api/pedidos/${d2.j.pedido.id}`, "PATCH", { estado: "en_camino" });
  const sinMotivo = await api(p, `/api/pedidos/${d2.j.pedido.id}`, "PATCH", { estado: "cancelado" });
  ok(sinMotivo.status === 422, "no se cancela sin motivo", String(sinMotivo.status));
  const can = await api(p, `/api/pedidos/${d2.j.pedido.id}`, "PATCH", { estado: "cancelado", motivo: "Dirección equivocada" });
  ok(can.status === 200 && can.j.pedido.estado === "cancelado", "domicilio en camino cancelado");
  ok(await stock(PD.id) === antes, "cancelar el domicilio no mueve existencias");
  const tarde = await api(p, `/api/pedidos/${d2.j.pedido.id}/cobrar`, "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: PD.id, presentacion: "unidad", cantidad: 2 }], pagos: [{ medio: "efectivo", valor: 100000 }] });
  ok(tarde.status === 422 && await stock(PD.id) === antes, "un pedido cancelado no se cobra", String(tarde.status));

  const e2 = await api(p, "/api/pedidos", "POST", { tipo: "espera", lineas: [{ producto_id: PB.id, presentacion: "unidad", cantidad: 3 }] });
  const id = e2.j.pedido.id, antesB = await stock(PB.id);
  const cuerpo = (k) => ({ idem_key: k, tipo_doc: "pos", lineas: [{ producto_id: PB.id, presentacion: "unidad", cantidad: 3 }], pagos: [{ medio: "efectivo", valor: 100000 }] });
  const k1 = crypto.randomUUID(), k2 = crypto.randomUUID();
  const r = await p.evaluate(async ([id, a, b]) => Promise.all([a, b].map(async (c) => { const r = await fetch(`/api/pedidos/${id}/cobrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); return { status: r.status, j: await r.json() }; })), [id, cuerpo(k1), cuerpo(k2)]);
  const buenos = r.filter((x) => x.status === 200);
  p.__provocados = (p.__provocados ?? 0) + r.filter((x) => x.status >= 400).length;
  ok(buenos.length === 1 && r.some((x) => [409, 422].includes(x.status)), "dos cobros simultáneos del mismo pedido → solo uno pasa", r.map((x) => `${x.status} ${x.j.error ?? ""}`).join(" | "));
  ok(Number((await q1(`select count(*) n from ventas where idem_key = any($1)`, [[k1, k2]])).n) === 1 && antesB - await stock(PB.id) === 3, "queda una sola venta y las existencias bajan una sola vez");
  const kOk = buenos[0]?.j ? (await q1(`select v.idem_key from pedidos_mostrador pm join ventas v on v.id = pm.venta_id where pm.id = $1`, [id])).idem_key : null;
  const re = await api(p, `/api/pedidos/${id}/cobrar`, "POST", cuerpo(kOk));
  ok(re.status === 200 && re.j.venta.repetida === true, "reintentar con la misma clave devuelve la misma venta (no duplica)");
  const otra = await api(p, `/api/pedidos/${id}/cobrar`, "POST", cuerpo(crypto.randomUUID()));
  ok(otra.status === 409, "un tercer cobro con otra clave → 409", String(otra.status));
}

// ───────────── 7) Vendedor: cotización → imprimir → la caja la convierte con aviso de precio cambiado
let cot;
{
  const V = await sesionDe({ uid: VEND, empresa: E.A, nombre: "Valeria (vendedora)", rol: "vendedor" });
  const { p } = V;
  await ir(p, "/pedidos/nuevo");
  ok(await p.getByRole("heading", { name: "Nuevo pedido" }).count() === 1, "el vendedor arma pedidos");
  await p.locator("#ed-buscar").fill(PC.nombre.slice(0, 45));
  const fila = p.locator('[aria-label="Resultados"] [role="option"]', { hasText: PC.nombre }).first();
  await fila.waitFor({ timeout: 10000 });
  await fila.getByRole("button").first().click();
  const ap = p.locator('aside[aria-label="Pedido"]');
  await ap.getByRole("button", { name: new RegExp(`^Cantidad de ${esc(PC.nombre)}`) }).click();
  await ap.getByLabel(`Cantidad de ${PC.nombre}`, { exact: true }).fill("3"); await p.keyboard.press("Enter");
  await p.locator("#ed-contacto").fill("Clínica San Rafael");
  await p.locator("#ed-telefono").fill("3151234567");
  await p.getByRole("button", { name: "15 días" }).click();
  await p.screenshot({ path: `${OUT}/vendedor-cotizacion-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Guardar cotización" }).click();
  await p.getByRole("status").filter({ hasText: /Cotización N\.º \d+ guardada/ }).waitFor({ timeout: 10000 });
  cot = await q1(`select id, numero, vence - current_date dias, creado_por from pedidos_mostrador where empresa_id = $1 and tipo = 'cotizacion' order by creado desc limit 1`, [E.A]);
  ok(cot.dias === 15 && cot.creado_por === VEND, "cotización guardada por la vendedora con 15 días de validez");
  const wa = await p.getByRole("link", { name: "Enviar por WhatsApp" }).getAttribute("href");
  const txt = decodeURIComponent(wa.split("text=")[1] ?? "");
  ok(wa.startsWith("https://wa.me/573151234567?text=") && txt.includes(`Cotización N.º ${cot.numero}`) && txt.includes(PC.nombre) && /sujetos a cambio/.test(txt), "botón WhatsApp con el texto de la cotización", txt.slice(0, 120));
  ok(await p.getByRole("link", { name: "Convertir en venta" }).count() === 0, "la vendedora no tiene «Convertir en venta» (no cobra)");
  // Imprimible
  await ir(p, `/tiquete/cotizacion/${cot.id}`);
  const doc = await p.locator("article").innerText();
  ok(new RegExp(`Cotización N\\.º ${String(cot.numero).padStart(4, "0")}`).test(doc) && /NIT 900000001-1/.test(doc) && /Válida hasta el/.test(doc) && /Precios sujetos a cambio/.test(doc) && doc.includes("Clínica San Rafael"),
    "cotización imprimible con datos de la droguería, validez y «precios sujetos a cambio»", doc.slice(0, 200));
  ok(await p.getByRole("button", { name: "Imprimir o guardar PDF" }).count() === 1 && await p.getByRole("link", { name: "Enviar por WhatsApp" }).count() === 1, "con botones de imprimir y WhatsApp");
  await p.screenshot({ path: `${OUT}/cotizacion-1440.png`, fullPage: true });
  // La vendedora no ve la caja ni cobra
  await p.goto(B + "/caja"); await p.waitForLoadState("networkidle");
  ok(new URL(p.url()).pathname === "/pedidos", "la vendedora no entra a la caja: va a Pedidos", p.url());
  const c403 = await api(p, `/api/pedidos/${cot.id}/cobrar`, "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: PC.id, presentacion: "caja", cantidad: 3 }], pagos: [{ medio: "efectivo", valor: 1000000 }] });
  ok(c403.status === 403, "la vendedora no cobra: 403", String(c403.status));
  const v403 = await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: PC.id, presentacion: "caja", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1000000 }] });
  ok(v403.status === 403, "ni por la venta normal: 403");
  ok(await p.content().then((h) => !/costo_unidad|Inventario a costo/.test(h)), "la vendedora no ve costos");
  ok(sinProvocados(p, V.errs).length === 0, "sin errores de consola (vendedora)", sinProvocados(p, V.errs).join(" | "));
  await V.ctx.close();

  // Sube el precio y la caja convierte la cotización avisando «antes y ahora»
  const precioAntes = PC.pc, precioNuevo = PC.pc + 1000;
  await pool.query(`update productos set precio_caja = $2 where id = $1`, [PC.id, precioNuevo]);
  const { p: c } = L;
  await ir(c, "/pedidos?tipo=cotizacion");
  const tj = c.getByRole("listitem", { name: `Cotización N.º ${cot.numero}`, exact: true });
  ok(await tj.getByText(/Cambiaron precios: hoy serían/).count() === 1, "Pedidos avisa que cambió el precio de la cotización");
  await Promise.all([c.waitForURL(/\/caja/), tj.getByRole("link", { name: "Convertir en venta" }).click()]);
  await c.waitForLoadState("networkidle");
  await aside.locator("li", { hasText: PC.nombre }).waitFor({ timeout: 10000 });
  const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CO");
  ok(await aside.getByText(`Cambió el precio: antes ${fmt(precioAntes)}, ahora ${fmt(precioNuevo)}`).count() === 1, "la línea muestra «antes X, ahora Y»", `${fmt(precioAntes)} → ${fmt(precioNuevo)}`);
  await c.keyboard.press("F9");
  ok(await aside.getByText(/cambió de precio desde el pedido: se cobra el precio de hoy/).count() === 1, "antes de cobrar avisa que se cobra el precio de hoy");
  await c.screenshot({ path: `${OUT}/caja-precio-cambiado-1440.png` });
  await c.getByRole("button", { name: "Exacto" }).click();
  await c.getByRole("button", { name: /Confirmar/ }).click();
  await c.getByText("Venta registrada").waitFor({ timeout: 15000 });
  const vc = await q1(`select v.total::float total from pedidos_mostrador pm join ventas v on v.id = pm.venta_id where pm.id = $1 and pm.estado = 'cobrado'`, [cot.id]);
  ok(vc?.total === 3 * precioNuevo, "la cotización convertida se cobra al precio vigente", JSON.stringify(vc));
  await pool.query(`update productos set precio_caja = $2 where id = $1`, [PC.id, precioAntes]);
  await c.keyboard.press("Enter");
}

// ───────────── 8) Vendedor invitado (droguería real) y aislamiento entre empresas
{
  const DB = await sesionDe({ uid: "00000000-0000-4000-8000-000000000004", empresa: E.B, nombre: "Dueño Vecina", rol: "dueno" });
  const { p } = DB;
  await ir(p, "/pedidos");
  const correo = `vendedor.${Date.now()}@prueba.example`;
  const inv = await api(p, "/api/equipo", "POST", { nombre: "Víctor Vendedor", email: correo, rol: "vendedor" });
  ok(inv.status === 201 && /\/activar\?t=/.test(inv.j.enlace ?? ""), "el dueño invita a un vendedor", `${inv.status} ${inv.j.error ?? ""}`);
  const cuenta = await q1(`select cu.id, m.rol from cuentas cu join miembros m on m.user_id = cu.id where cu.email = $1 and m.empresa_id = $2`, [correo, E.B]);
  ok(cuenta?.rol === "vendedor", "queda con rol vendedor");
  // Aislamiento: B no ve ni toca los pedidos de A
  const lista = await api(p, "/api/pedidos?estado=todos");
  ok(lista.status === 200 && lista.j.pedidos.length === 0, "otra droguería no ve los pedidos de A");
  ok((await api(p, `/api/pedidos/${cot.id}`)).status === 404, "GET de un pedido ajeno → 404");
  ok((await api(p, `/api/pedidos/${domi.id}`, "PATCH", { estado: "cancelado", motivo: "Intento ajeno" })).status === 404, "cancelar un pedido ajeno → 404");
  ok((await api(p, `/api/pedidos/${domi.id}/cobrar`, "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: PD.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 100000 }] })).status === 404, "cobrar un pedido ajeno → 404");
  ok((await api(p, "/api/pedidos", "POST", { tipo: "espera", lineas: [{ producto_id: PD.id, presentacion: "unidad", cantidad: 1 }] })).status === 422, "no se arma un pedido con productos ajenos");
  // /tiquete tiene loading.tsx (límite de Suspense contra el React 418): notFound() llega por streaming con estado 200.
  await p.goto(`${B}/tiquete/cotizacion/${cot.id}`); await p.waitForLoadState("networkidle");
  const ajeno = await p.locator("body").innerText();
  ok(/404|no (existe|se encontr)/i.test(ajeno) && !ajeno.includes("Cotización N.º"), "la cotización de otra droguería no se abre", ajeno.slice(0, 80).replace(/\s+/g, " "));
  await DB.ctx.close();

  // El vendedor invitado entra: ve Pedidos y no la Caja
  const V = await sesionDe({ uid: cuenta.id, empresa: E.B, nombre: "Víctor Vendedor", rol: "vendedor" });
  await ir(V.p, "/pedidos");
  ok(await V.p.getByRole("heading", { name: "Pedidos", exact: true }).count() === 1, "el vendedor invitado abre Pedidos");
  const nav = V.p.getByRole("navigation", { name: "Principal" });
  ok(await nav.getByRole("link", { name: "Pedidos" }).count() === 1 && await nav.getByRole("link", { name: "Caja" }).count() === 0, "en el menú ve Pedidos y no la Caja");
  ok(await V.p.getByRole("link", { name: "Ir a la caja" }).count() === 0, "sin acceso directo a la caja");
  ok((await api(V.p, `/api/pedidos/${cot.id}/cobrar`, "POST", {})).status === 403, "cobrar → 403 (el permiso se mira antes que los datos)");
  ok(sinProvocados(V.p, V.errs).length === 0, "sin errores de consola (vendedor invitado)", sinProvocados(V.p, V.errs).join(" | "));
  await V.ctx.close();
  const bodega = await entrar("Andrés");
  ok((await api(bodega.p, "/api/pedidos")).status === 403, "la bodega no maneja pedidos (403)");
  await bodega.ctx.close();
}

ok(sinProvocados(L.p, L.errs).length === 0, "sin errores de consola (cajera)", sinProvocados(L.p, L.errs).join(" | "));
await L.ctx.close();

// ───────────── 9) Celular
{
  const M = await entrar("Laura", { ...devices["iPhone 13"] });
  const { p } = M;
  await ir(p, "/caja");
  await agregar(p, PA, true);
  ok(await desborde(p) <= 0 && (await cortados(p)).length === 0, "caja con venta en el celular sin desbordes", JSON.stringify(await cortados(p)));
  await p.getByRole("button", { name: "Domicilio", exact: true }).click();
  await p.getByRole("dialog").waitFor();
  ok(await desborde(p) <= 0 && (await cortados(p)).length === 0, "cuadro de domicilio sin desbordes", JSON.stringify(await cortados(p)));
  await p.screenshot({ path: `${OUT}/caja-domicilio-iphone13.png` });
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: /^Recuperar( F6)?$/ }).click();
  await p.getByRole("dialog").waitFor();
  await p.getByRole("button", { name: "Cotizaciones" }).click();
  await p.waitForLoadState("networkidle");
  ok(await desborde(p) <= 0 && (await cortados(p)).length === 0, "lista para recuperar sin desbordes", JSON.stringify(await cortados(p)));
  await p.screenshot({ path: `${OUT}/caja-recuperar-iphone13.png` });
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: `Quitar ${PA.nombre}` }).click();
  for (const [ruta, nombre] of [["/pedidos?estado=todos", "pedidos"], ["/pedidos/nuevo", "pedido-nuevo"], [`/tiquete/cotizacion/${cot.id}`, "cotizacion"], [`/pedidos/${(await q1(`select id from pedidos_mostrador where empresa_id = $1 and estado = 'abierto' order by creado desc limit 1`, [E.A]))?.id ?? cot.id}`, "pedido-editar"]]) {
    await ir(p, ruta);
    ok(await desborde(p) <= 0 && (await cortados(p)).length === 0, `${ruta} sin desbordes en el celular`, JSON.stringify(await cortados(p)));
    await p.screenshot({ path: `${OUT}/${nombre}-iphone13.png`, fullPage: true });
  }
  ok(sinProvocados(p, M.errs).length === 0, "sin errores de consola (celular)", sinProvocados(p, M.errs).join(" | "));
  await M.ctx.close();
}

await pool.query(`update cajas set activa = false where id = $1`, [C2]);
await pool.query(`update miembros set activo = false where empresa_id = $1 and user_id = $2`, [E.A, VEND]);
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
