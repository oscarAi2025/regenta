// Compras: la factura original del proveedor dentro de la compra (verla, descargarla, adjuntarla después), productos en
// el listado, e Inventario a costo sin los lotes con el costo de la caja escrito por unidad (20/11/2026, pedido de Oscar:
// «stock a costo de 600 millones» y «en las compras no se ven los ítems ni las facturas»).
// Uso: BASE=… DATABASE_URL=… REGENTA_SESSION_SECRET=… node tests/e2e/compra-adjunto.mjs
import { chromium } from "playwright-core";
import pg from "pg";
import { SignJWT } from "jose";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const q1 = async (sql, v = []) => (await pool.query(sql, v)).rows[0];
const R = Date.now().toString(36).slice(-5).toUpperCase();
const SECRETO = new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef");
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

// PDF mínimo válido (una página con texto) y una imagen PNG de 1×1.
const PDF = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 20 100 Td (Factura ${R}) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function sesion(uid, empresa, rol, nombre) {
  const jwt = await new SignJWT({ uid, empresa, nombre, rol, v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(SECRETO);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "regenta_sesion", value: jwt, url: B }]);
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));
  return { ctx, p, errs };
}
const subir = (p, compra, nombre, tipo, datos) => p.evaluate(async ([c, n, t, d]) => {
  const fd = new FormData(); fd.append("archivo", new File([Uint8Array.from(atob(d), (x) => x.charCodeAt(0))], n, { type: t }));
  const r = await fetch(`/api/compras/${c}/factura`, { method: "POST", body: fd });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}, [compra, nombre, tipo, datos.toString("base64")]);
const traer = (p, url) => p.evaluate(async (u) => {
  const r = await fetch(u); const buf = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, tipo: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), marco: r.headers.get("x-frame-options"), csp: r.headers.get("content-security-policy"), n: buf.length, ini: String.fromCharCode(...buf.slice(0, 5)) };
}, url);

const EB = await q1(`select id from empresas where not demo and nit = '900000002'`);
const DUENO_B = "00000000-0000-4000-8000-000000000004";
const prod = (await q1(`insert into productos (empresa_id, nombre, laboratorio, unidades_por_caja, precio_caja, iva) values ($1, $2, 'Lab B', 1, 5000, 0) returning id`, [EB.id, `Producto Adjunto ${R}`])).id;

// ───────────── Droguería real: compra registrada a mano, sin factura → se adjunta después
const { ctx, p, errs } = await sesion(DUENO_B, EB.id, "dueno", "Dueño Vecina");
await p.goto(B + "/compras");
const nueva = (n, lote, prov) => p.evaluate(async ([pid, n, l, prov]) => {
  const r = await fetch("/api/compras", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    idem_key: crypto.randomUUID(), ...(prov ? { proveedor_id: prov } : { proveedor_nuevo: { nombre: `Mayorista Adjuntos ${l}`, nit: null } }), numero_factura: n, fecha_factura: "2026-11-14",
    lineas: [{ producto_id: pid, lote: l, vence: "2029-01-31", unidades: 3, bonificadas: 0, costo: 2500, costo_por: "unidad", descuento_pct: 0, iva_pct: 0 }] }) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}, [prod, n, lote, prov ?? null]);
const c1 = await nueva(`FA-${R}`, `LA${R}`);
const prov1 = (await q1(`select proveedor_id from compras where empresa_id = $1 and numero_factura = $2`, [EB.id, `FA-${R}`]))?.proveedor_id;
const c2 = await nueva(`FB-${R}`, `LB${R}`, prov1);
ok(c1.status === 201 && c2.status === 201, "dos compras registradas a mano (sin archivo)", `${c1.status} ${c2.status} ${c1.j.error ?? ""} ${c2.j.error ?? ""}`);
const id1 = c1.j.id ?? c1.j.compra?.id, id2 = c2.j.id ?? c2.j.compra?.id;

await p.goto(B + `/compras/${id1}`); await p.waitForLoadState("networkidle");
const sec = p.locator('section[aria-labelledby="factura-proveedor"]');
ok(await sec.isVisible() && /se registró sin la factura/.test(await sec.innerText()), "la compra muestra «Factura del proveedor» y que falta adjuntarla");
await sec.locator('input[type="file"]').setInputFiles({ name: `factura-${R}.pdf`, mimeType: "application/pdf", buffer: PDF });
await sec.getByRole("status").waitFor({ timeout: 15000 });
ok(/Factura adjunta a la compra/.test(await sec.getByRole("status").innerText()), "subida desde la pantalla", await sec.getByRole("status").innerText());
ok(/factura-.*\.pdf/.test(await sec.innerText()) && /PDF ·/.test(await sec.innerText()), "subida desde la pantalla: aparece en la lista con tipo y tamaño", (await sec.innerText()).replace(/\n/g, " ").slice(0, 200));
ok(await sec.locator("iframe").count() === 1, "el PDF se ve dentro de la compra");
await p.reload(); await p.waitForLoadState("networkidle");
ok(await p.locator('section[aria-labelledby="factura-proveedor"] iframe').count() === 1, "al volver a entrar, la factura sigue ahí");
const a1 = await q1(`select id, compra_id, tipo, tamano from compra_archivos where compra_id = $1`, [id1]);
ok(a1?.tipo === "application/pdf" && a1.tamano === PDF.length, "guardada en el espacio de la droguería, enlazada a la compra", JSON.stringify(a1));

const ver = await traer(p, `/api/compras/${id1}/factura?archivo=${a1.id}`);
ok(ver.status === 200 && ver.tipo === "application/pdf" && /^inline/.test(ver.disp) && ver.ini === "%PDF-" && ver.n === PDF.length, "«Ver»: el PDF tal cual, para abrir en el navegador", JSON.stringify(ver));
ok(ver.marco === "SAMEORIGIN" && /frame-ancestors 'self'/.test(ver.csp ?? "") && !/object-src 'none'/.test(ver.csp ?? ""), "se deja enmarcar solo por Regenta (y Chrome puede abrir el PDF)", `${ver.marco} · ${ver.csp}`);
const des = await traer(p, `/api/compras/${id1}/factura?archivo=${a1.id}&descargar=1`);
ok(des.status === 200 && /^attachment; filename="factura-.*\.pdf"/.test(des.disp), "«Descargar»: como archivo", des.disp);
const otraPagina = await traer(p, "/compras");
ok(/frame-ancestors 'none'/.test(otraPagina.csp ?? "") && otraPagina.marco === "DENY", "el resto de Regenta sigue sin dejarse enmarcar", `${otraPagina.marco}`);

// Foto como segundo archivo, el mismo archivo en otra compra, un archivo que no es factura
const foto = await subir(p, id1, "foto.png", "image/png", Buffer.concat([PNG, Buffer.from(R)]));
ok(foto.status === 201 && foto.j.archivos?.length === 2, "también una foto (segundo archivo de la misma compra)", `${foto.status} ${foto.j.error ?? ""}`);
const repetido = await subir(p, id2, "otra.pdf", "application/pdf", PDF);
ok(repetido.status === 409 && /ya está adjunto a la compra N\.º/.test(repetido.j.error ?? ""), "el mismo archivo no se adjunta a otra compra", repetido.j.error);
const texto = await subir(p, id2, "notas.txt", "text/plain", Buffer.from("hola"));
ok(texto.status === 415, "un archivo que no es factura se rechaza (415)", texto.j.error);
const cruzado = await traer(p, `/api/compras/${id2}/factura?archivo=${a1.id}`);
ok(cruzado.status === 404, "un archivo solo se abre desde su propia compra", String(cruzado.status));

// Listado: productos de cada compra y si tiene la factura
await p.goto(B + "/compras"); await p.waitForLoadState("networkidle");
const f1 = p.locator("tbody tr").filter({ hasText: `FA-${R}` }), f2 = p.locator("tbody tr").filter({ hasText: `FB-${R}` });
ok(/1 producto: Producto Adjunto/.test(await f1.innerText()) && /Factura adjunta/.test(await f1.innerText()), "listado: productos de la compra y «Factura adjunta»", (await f1.innerText()).replace(/\n/g, " "));
ok(/Sin factura adjunta/.test(await f2.innerText()), "listado: «Sin factura adjunta» en la que falta", (await f2.innerText()).replace(/\n/g, " "));
ok(errs.length === 0, "sin errores en el navegador", errs.join(" | "));
await ctx.close();

// ───────────── Aislamiento y roles
{
  const DEMO = await q1(`select id from empresas where demo limit 1`);
  const duenoDemo = (await q1(`select user_id from miembros where empresa_id = $1 and rol = 'dueno' limit 1`, [DEMO.id])).user_id;
  const o = await sesion(duenoDemo, DEMO.id, "dueno", "Otro dueño");
  await o.p.goto(B + "/compras");
  const ajeno = await traer(o.p, `/api/compras/${id1}/factura?archivo=${a1.id}`);
  ok(ajeno.status === 404, "otra droguería no abre la factura (404)", String(ajeno.status));
  const adjAjeno = await subir(o.p, id1, "x.pdf", "application/pdf", Buffer.concat([PDF, Buffer.from(R)]));
  ok(adjAjeno.status === 404, "ni adjunta archivos a una compra ajena", `${adjAjeno.status} ${adjAjeno.j.error ?? ""}`);
  const demoCompra = (await q1(`select id from compras where empresa_id = $1 and estado <> 'anulada' order by creado desc limit 1`, [DEMO.id]))?.id;
  if (demoCompra) {
    const enDemo = await subir(o.p, demoCompra, "d.pdf", "application/pdf", Buffer.concat([PDF, Buffer.from("demo" + R)]));
    ok(enDemo.status === 409 && /demostración/.test(enDemo.j.error ?? ""), "en la demo no se guardan archivos", enDemo.j.error);
  }
  await o.ctx.close();
  const cajera = await q1(`select user_id from miembros where empresa_id = $1 and rol = 'cajero' limit 1`, [EB.id]);
  if (cajera) {
    const k = await sesion(cajera.user_id, EB.id, "cajero", "Cajera");
    await k.p.goto(B + "/caja");
    ok((await traer(k.p, `/api/compras/${id1}/factura?archivo=${a1.id}`)).status === 403, "la cajera no ve facturas de compra (403)");
    await k.ctx.close();
  }
}

// ───────────── Inventario a costo: el costo de la caja escrito por unidad no infla el valor
{
  const o = await sesion(DUENO_B, EB.id, "dueno", "Dueño Vecina");
  const valor = async () => { await o.p.goto(B + "/inventario"); await o.p.waitForLoadState("networkidle");
    const t = await o.p.locator("main").innerText(); return Number((t.match(/Inventario a costo\s*\$([\d.]+)/) ?? [])[1]?.replace(/\./g, "") ?? NaN); };
  const antes0 = await valor();
  // Un producto con IVA (19 %) y costo normal sí suma: $8.000 de costo con precio $11.900 IVA incluido ($10.000 sin IVA).
  const conIva = await o.p.evaluate(async (n) => (await fetch("/api/productos", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ nombre: n, iva: 19, unidades_por_caja: 1, precio_caja: 11900, stock_minimo: 0, existencia: { lote: "IV1", vence: "2029-06-30", unidades: 10, costo_unidad: 8000 } }) })).status, `Crema con IVA ${R}`);
  const antes = await valor();
  ok(conIva === 201 && Math.abs(antes - antes0 - 80000) <= 1, "un producto con IVA y costo normal suma al inventario (el IVA va en porcentaje)", `${conIva} ${antes0} → ${antes}`);
  const r = await o.p.evaluate(async (n) => (await fetch("/api/productos", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ nombre: n, iva: 0, unidades_por_caja: 500, precio_caja: 36850, precio_unidad: 100, stock_minimo: 0, existencia: { lote: "BJ1", vence: "2029-06-30", unidades: 18000, costo_unidad: 62.56 } }) })).json(), `Bajalenguas adjunto ${R} caja x 500`);
  const pid = r.id;
  const conBien = await valor();
  ok(Math.abs(conBien - antes - 18000 * 62.56) <= 2, "18.000 und a $62,56 suman $1.126.080 al inventario", `${antes} → ${conBien}`);
  await pool.query(`update lote_costos set costo_unidad = 31280 where lote_id = (select id from lotes where producto_id = $1 and lote = 'BJ1')`, [pid]); // dato viejo, como en producción
  const conMal = await valor();
  ok(Math.abs(conMal - antes) <= 2, "con $31.280 por unidad (el costo de la caja) no se suman $563 millones", `${antes} → ${conMal}`);
  const aviso = o.p.locator('section[aria-labelledby="revisar-t"]');
  ok(await aviso.isVisible() && /\$31\.280 por unidad/.test(await aviso.innerText()) && /en existencia/.test(await aviso.innerText()) && /\$563\.040\.000/.test(await aviso.innerText()),
    "aviso «Costos que no cuadran» en Inventario con lo que valdría", (await aviso.innerText()).replace(/\n/g, " ").slice(0, 260));
  await aviso.getByRole("button", { name: /Era el costo de la caja/ }).click();
  await aviso.getByText("Costo corregido").waitFor();
  const corregido = await valor();
  ok(Math.abs(corregido - conBien) <= 2 && await o.p.locator('section[aria-labelledby="revisar-t"]').count() === 0, "corregido en un clic: vuelve a sumar $1.126.080 y el aviso se va", `${corregido}`);
  await o.ctx.close();
}

await b.close(); await pool.end();
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
