// Recuperación de pagos y embudo sin pruebas (21/11/2026): un QR sin confirmar recibe el correo que toca por su edad
// (2 h, 24 h, 72 h) con copia a la gerencia; un pago con pasarela abandonado recibe el segundo correo a las 24 h; nada
// sale a pruebas ni a quien ya pagó; la consola marca pruebas, muestra la antigüedad y el WhatsApp con el mensaje; el
// equipo (cookie regenta_interno) no cuenta en el embudo.
// Uso: servidor con REGENTA_DEMO=1 → BASE=… DATABASE_URL=… REGENTA_CRON_KEY=… node tests/e2e/recuperar-pagos.mjs
import { execFileSync } from "node:child_process";
import pg from "pg";
import { chromium } from "playwright-core";
import { codigoTotp, olvidarUltimo, TOTP } from "../ayudas/totp.mjs";

const B = process.env.BASE ?? "http://localhost:4500", DB = process.env.DATABASE_URL, CRON = process.env.REGENTA_CRON_KEY;
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
const sufijo = String(Date.now()).slice(-7);
const correos = (para) => q(`select plantilla, datos from correos where para = $1 order by id`, [para]);
const avisos = (ref) => q(`select datos->>'evento' evento, datos from correos where plantilla = 'aviso_interno' and datos->>'referencia' = $1 order by id`, [ref]);

// Órdenes de distintas edades
const orden = async (n, proveedor, horas, extra = {}) => {
  const ref = `RG-ESE-REC${sufijo}${n}`, email = extra.email ?? `rec${n}-${sufijo}@pago.test`;
  await q(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, nit, email, telefono, estado, creado, detalle)
    values ($1, 'esencial', 'mes', 89900, $2, 'Franco Pérez', $3, $4, $5, '3001112233', $6, now() - make_interval(hours => $7), $8)`,
    [ref, proveedor, extra.empresa ?? "Droguería Central", extra.nit ?? `9${sufijo}${n}`, email, extra.estado ?? "pendiente", horas, extra.detalle ?? null]);
  return { ref, email };
};
const qr3h = await orden(1, "qr", 3), qr30h = await orden(2, "qr", 30), qr80h = await orden(3, "qr", 80), qr1h = await orden(4, "qr", 1);
const qrViejo = await orden(5, "qr", 24 * 17); // como el de franco: demasiado viejo para correos automáticos (se llama a mano)
const qrPrueba = await orden(6, "qr", 3, { empresa: "PRUEBA INTERNA - NO ATENDER" });
const qrMarcado = await orden(7, "qr", 3, { detalle: JSON.stringify({ prueba: true }) });
const qrPagado = await orden(8, "qr", 5, { nit: `7${sufijo}`, email: `pagado${sufijo}@pago.test` });
await orden(9, "wompi", 1, { nit: `7${sufijo}`, email: `otro${sufijo}@pago.test`, estado: "aprobado" }); // la misma droguería pagó otra orden después
const stripe30h = await orden(10, "stripe", 30);

const tarea = async () => (await fetch(B + "/api/tareas", { method: "POST", headers: { authorization: `Bearer ${CRON}` } })).json();
const r1 = await tarea();
ok(r1.recuperar_pagos && !r1.recuperar_pagos.error, "la tarea programada corre la recuperación de pagos", JSON.stringify(r1.recuperar_pagos));

const p1 = (await correos(qr3h.email)).map((x) => x.plantilla);
ok(p1.includes("pago_qr_recordatorio_1") && !p1.includes("pago_qr_recordatorio_2"), "QR de 3 h: correo «¿pudiste pagar?» (solo el primero)", p1.join(","));
const c1 = (await correos(qr3h.email)).find((x) => x.plantilla === "pago_qr_recordatorio_1");
ok(c1?.datos?.referencia === qr3h.ref && c1?.datos?.monto === 89900, "lleva su referencia y el monto (el enlace al QR se borra al enviarse)", JSON.stringify(c1?.datos));
const av1 = await avisos(qr3h.ref);
ok(av1.some((a) => a.evento === "pago_qr_recordatorio_1" && a.datos.telefono === "3001112233"), "la gerencia recibe copia con el celular para llamarlo", av1.map((a) => a.evento).join(","));
const p2 = (await correos(qr30h.email)).map((x) => x.plantilla);
ok(p2.includes("pago_qr_recordatorio_2") && !p2.includes("pago_qr_recordatorio_1"), "QR de 30 h: el segundo correo, no los atrasados", p2.join(","));
const p3 = (await correos(qr80h.email)).map((x) => x.plantilla);
ok(p3.includes("pago_qr_recordatorio_3") && p3.length === 1, "QR de 80 h: el último correo", p3.join(","));
ok((await correos(qr1h.email)).length === 0, "QR de 1 h: todavía nada");
ok((await correos(qrViejo.email)).length === 0, "QR de 17 días: no recibe correos atrasados");
ok((await correos(qrPrueba.email)).length === 0 && (await correos(qrMarcado.email)).length === 0, "las pruebas (por nombre o marcadas) no reciben nada");
ok((await correos(qrPagado.email)).length === 0, "quien ya pagó otra orden con el mismo NIT no recibe recordatorios");
const ps = (await correos(stripe30h.email)).map((x) => x.plantilla);
ok(ps.includes("pago_abandonado_2"), "pago con pasarela abandonado hace 30 h: segundo correo de ayuda", ps.join(","));

await tarea();
ok((await correos(qr3h.email)).filter((x) => x.plantilla === "pago_qr_recordatorio_1").length === 1, "cada paso sale una sola vez aunque la tarea corra de nuevo");

// Las plantillas se arman y se envían (en local, simulado)
const estados = await q(`select plantilla, estado from correos where para = any($1) and plantilla like 'pago_%'`, [[qr3h.email, qr30h.email, qr80h.email, stripe30h.email]]);
ok(estados.length >= 4 && estados.every((x) => x.estado === "simulado"), "las cuatro plantillas nuevas se arman y salen", JSON.stringify(estados));

// ── Consola: antigüedad, WhatsApp con mensaje, «Es una prueba» y embudo sin pruebas
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
try {
  const A = { email: `admin-rec${sufijo}@regenta.test`, clave: "ConsolaRecupera2026" };
  execFileSync("node", ["scripts/crear-superadmin.mjs", A.email, "Admin Recupera"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: A.clave, REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });
  const ctx = await b.newContext(); const c = await ctx.newPage();
  await c.goto(B + "/admin/entrar"); await c.fill("#a-email", A.email); await c.fill("#a-clave", A.clave);
  await c.getByRole("button", { name: "Entrar" }).click();
  const conCodigo = await c.locator("#a-codigo").waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  if (conCodigo) { await olvidarUltimo(pool, A.email); await c.fill("#a-codigo", codigoTotp()); await Promise.all([c.waitForURL(/\/admin$/, { timeout: 30000 }), c.getByRole("button", { name: "Entrar" }).click()]); }
  else await c.waitForURL(/\/admin$/, { timeout: 30000 });
  ok(/Pagos a medias: llámalos/.test(await c.locator("main").innerText()) && /por QR sin confirmar hace más de 2 h/.test(await c.locator("main").innerText()), "el resumen de la consola pide llamar los pagos a medias");
  await c.goto(B + "/admin/pagos?ver=qr");
  const filaQr = c.locator("tr", { hasText: qr3h.ref });
  ok(/hace 3 h: revisa la cuenta y llámalo/.test(await filaQr.innerText()), "la fila muestra hace cuánto espera y qué hacer");
  const href = await filaQr.getByRole("link", { name: "WhatsApp" }).getAttribute("href");
  ok(/wa\.me\/573001112233\?text=/.test(href ?? "") && /referencia/.test(decodeURIComponent(href ?? "")), "WhatsApp con el mensaje y la referencia ya escritos");
  ok(await c.locator("tr", { hasText: qrPrueba.ref }).count() === 0, "las pruebas no salen en «QR por confirmar»");
  const [resp] = await Promise.all([c.waitForResponse((r) => r.url().includes("/api/admin/pagos") && r.request().method() === "PATCH"),
    (async () => { await filaQr.getByRole("button", { name: "Es una prueba" }).click(); await filaQr.getByRole("button", { name: /Sí$/ }).click(); })()]);
  ok(resp.ok(), "«Es una prueba» responde bien");
  const marcado = (await q(`select estado, detalle from pagos_suscripcion where referencia = $1`, [qr3h.ref]))[0];
  ok(marcado.detalle?.prueba === true && marcado.estado === "rechazado", "queda como prueba y la orden se cierra", JSON.stringify(marcado));
  // La cookie del equipo: el navegador de la consola ya no cuenta en el embudo
  const cookie = (await ctx.cookies()).find((k) => k.name === "regenta_interno");
  ok(cookie?.value === "1", "entrar a la consola marca el navegador como del equipo");
  const antes = (await q(`select count(*)::int n from web_eventos`))[0].n;
  await c.goto(B + "/precios"); await c.waitForLoadState("networkidle"); await new Promise((r) => setTimeout(r, 1200));
  ok((await q(`select count(*)::int n from web_eventos`))[0].n === antes, "las visitas del equipo no se registran en el embudo");
  const api = await c.evaluate(async () => (await fetch("/api/web/evento", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo: "vista", ruta: "/" }) })).status);
  ok(api === 200 && (await q(`select count(*)::int n from web_eventos`))[0].n === antes, "ni aunque se envíen a mano");
  // ?interno=1 en otro navegador (el celular de Oscar) y ?interno=0 lo quita
  const m = await (await b.newContext()).newPage();
  await m.goto(B + "/?interno=1"); await m.waitForLoadState("networkidle"); await new Promise((r) => setTimeout(r, 800));
  ok(/regenta_interno=1/.test(await m.evaluate(() => document.cookie)), "?interno=1 marca un navegador como del equipo");
  await m.goto(B + "/?interno=0"); await m.waitForLoadState("networkidle");
  ok(!/regenta_interno=1/.test(await m.evaluate(() => document.cookie)), "?interno=0 lo desmarca");
  // Embudo: los pagos de prueba no cuentan
  await c.goto(B + "/admin/demo?dias=7");
  ok(/Sin el equipo ni las pruebas/.test(await c.locator("main").innerText()), "el embudo aclara que no cuenta al equipo ni las pruebas");
  const n = (await q(`select count(*)::int n from pagos_suscripcion p where creado > now() - interval '7 days' and not (coalesce(p.detalle ? 'prueba', false) or p.empresa ~* '(^|[^a-z])prueba' or exists (select 1 from superadmins sa join cuentas sc on sc.id = sa.user_id where lower(sc.email) = lower(p.email)))`))[0].n;
  ok(n > 0, "quedan pagos reales para el embudo", String(n));
} finally {
  await b.close(); await pool.end();
}
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
