// Pagos de suscripción de punta a punta con llaves de prueba (el servidor debe arrancar con las variables de abajo):
//   WOMPI_PUBLIC_KEY=pub_test_prueba WOMPI_INTEGRITY_SECRET=test_integrity_prueba WOMPI_EVENTS_SECRET=test_events_prueba
//   STRIPE_SECRET_KEY=sk_test_prueba STRIPE_WEBHOOK_SECRET=whsec_prueba WOMPI_API_URL=http://localhost:4602
// La API de Wompi se simula aquí mismo en :4602 (el webhook siempre confirma la transacción contra ella).
// Comprueba el enlace firmado de Wompi, eventos auténticos y falsos, monto alterado, webhook de Stripe y la pantalla.
import { chromium } from "playwright-core";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";

const WOMPI = new Map(); // id → transacción tal como la devolvería la API de Wompi
const mock = createServer((req, res) => {
  const id = decodeURIComponent((req.url ?? "").split("/transactions/")[1] ?? "");
  const t = WOMPI.get(id);
  res.writeHead(t ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(t ? { data: t } : { error: { type: "NOT_FOUND_ERROR" } }));
}).listen(4602);

const B = process.env.BASE ?? "http://localhost:4500";
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const IP = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`; // IP propia por corrida (límite de órdenes por IP)
const post = (ruta, cuerpo, h = {}) => fetch(B + ruta, { method: "POST", headers: { "content-type": "application/json", origin: B, "x-real-ip": IP, ...h }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });
const estado = async (ref) => (await (await fetch(`${B}/api/pagos/estado?ref=${ref}`)).json()).estado;
const datos = { nombre: "Prueba Pagos", empresa: "Droguería Prueba", nit: "901845370", email: "pagos@prueba.example", telefono: "3001234567", acepta: true };

// ── Wompi: orden, enlace y firma
const r = await post("/api/pagos", { plan: "pro", periodo: "anio", proveedor: "wompi", ...datos });
const j = await r.json();
ok(r.status === 201 && j.url?.startsWith("https://checkout.wompi.co/p/?"), "Wompi: devuelve el enlace del checkout", String(r.status));
const u = new URL(j.url);
ok(u.searchParams.get("amount-in-cents") === String(139900 * 10 * 100), "Wompi: anual = 10 meses, en centavos", u.searchParams.get("amount-in-cents"));
ok(u.searchParams.get("signature:integrity") === sha(`${j.referencia}${139900 * 10 * 100}COPtest_integrity_prueba`), "Wompi: firma de integridad correcta");
ok(u.searchParams.get("redirect-url")?.includes(`/contratar/resultado?ref=${j.referencia}`), "Wompi: vuelve a la página de resultado");
ok(await estado(j.referencia) === "pendiente", "la orden queda pendiente");

const evento = (t, secreto = "test_events_prueba") => {
  const e = { event: "transaction.updated", data: { transaction: t }, signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"] }, timestamp: Math.floor(Date.now() / 1000) };
  e.signature.checksum = sha(`${t.id}${t.status}${t.amount_in_cents}${e.timestamp}${secreto}`);
  return e;
};
const RUN = Date.now().toString(36); // ids de transacción únicos por corrida (en Wompi nunca se repiten)
const tx = { id: `12345-${RUN}-11111`, reference: j.referencia, status: "APPROVED", amount_in_cents: 139900 * 10 * 100, currency: "COP", payment_method_type: "BANCOLOMBIA_QR" };
WOMPI.set(tx.id, tx);
ok((await post("/api/pagos/wompi", evento(tx, "secreto_falso"))).status === 401, "Wompi: evento con firma falsa rechazado");
ok(await estado(j.referencia) === "pendiente", "la firma falsa no cambia nada");
ok((await post("/api/pagos/wompi", evento(tx))).status === 200, "Wompi: evento auténtico aceptado");
ok(await estado(j.referencia) === "aprobado", "pago aprobado con QR Bancolombia");
ok((await post("/api/pagos/wompi", evento({ ...tx, status: "DECLINED" }))).status === 200 && await estado(j.referencia) === "aprobado", "un evento viejo no deshace un aprobado");

// Referencia cambiada en un evento auténtico reenviado: manda lo que dice la API de Wompi, no el evento
const r3 = await (await post("/api/pagos", { plan: "pro", periodo: "anio", proveedor: "wompi", ...datos })).json();
ok((await post("/api/pagos/wompi", evento({ ...tx, reference: r3.referencia }))).status === 200 && await estado(r3.referencia) === "pendiente", "Wompi: un evento con la referencia de otra orden no la aprueba");
ok((await post("/api/pagos/wompi", evento({ ...tx, id: "no-existe-1" }))).status === 503, "Wompi: transacción que la API no confirma → 503 para reintentar");

// Monto alterado: la orden no se aprueba
const r2 = await (await post("/api/pagos", { plan: "esencial", periodo: "mes", proveedor: "wompi", ...datos })).json();
WOMPI.set(`999-${RUN}`, { ...tx, id: `999-${RUN}`, reference: r2.referencia, amount_in_cents: 100 });
await post("/api/pagos/wompi", evento({ ...tx, id: `999-${RUN}`, reference: r2.referencia, amount_in_cents: 100 }));
ok(await estado(r2.referencia) === "error", "Wompi: monto distinto al de la orden queda en error");

// Anulado es final: un APPROVED reenviado no lo revive
const r4 = await (await post("/api/pagos", { plan: "esencial", periodo: "mes", proveedor: "wompi", ...datos })).json();
const tx4 = { ...tx, id: `444-${RUN}`, reference: r4.referencia, amount_in_cents: 89900 * 100 };
WOMPI.set(tx4.id, tx4); await post("/api/pagos/wompi", evento(tx4));
const aprobado4 = await estado(r4.referencia);
WOMPI.set(tx4.id, { ...tx4, status: "VOIDED" }); await post("/api/pagos/wompi", evento({ ...tx4, status: "VOIDED" }));
const anulado4 = await estado(r4.referencia);
WOMPI.set(tx4.id, tx4); await post("/api/pagos/wompi", evento(tx4));
ok(aprobado4 === "aprobado" && anulado4 === "anulado" && await estado(r4.referencia) === "anulado", "Wompi: aprobado → anulado, y un evento viejo no lo revive", `${aprobado4}/${anulado4}`);

// ── Validaciones y seguridad de la orden
ok((await post("/api/pagos", { plan: "pro", periodo: "mes", proveedor: "wompi", ...datos, acepta: false })).status === 400, "sin autorizar datos no hay orden");
ok((await post("/api/pagos", { plan: "pro", periodo: "mes", proveedor: "wompi", ...datos }, { origin: "https://otro.example" })).status === 403, "otro origen rechazado");
ok((await fetch(`${B}/api/pagos/estado?ref=../../etc`)).status === 400, "referencia inválida rechazada");

// ── Stripe: la red a api.stripe.com no está en las pruebas: la orden queda en error con mensaje claro; el webhook firmado aprueba
const rs = await post("/api/pagos", { plan: "pro", periodo: "mes", proveedor: "stripe", ...datos });
ok(rs.status === 502 || rs.status === 201, "Stripe: sin red responde con mensaje claro", String(rs.status));
const q = await import("pg"); const pool = new q.default.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
const refS = `RG-PRO-PRUEBA${Date.now().toString(36).toUpperCase()}-ABCDEF12`;
await pool.query(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, email, telefono, transaccion) values ($1, 'pro', 'mes', 139900, 'stripe', 'P', 'E', 'e@e.co', '300', 'cs_test_1')`, [refS]);
const firmar = (c) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac("sha256", "whsec_prueba").update(`${t}.${c}`).digest("hex")}`; };
const estadoS = async (r = refS) => (await pool.query(`select estado from pagos_suscripcion where referencia = $1`, [r])).rows[0]?.estado;
const sesion = (x) => JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_1", mode: "subscription", currency: "cop", amount_total: 13990000, client_reference_id: refS, payment_status: "paid", subscription: "sub_1", ...x } } });
const cuerpo = sesion({});
ok((await post("/api/pagos/stripe", cuerpo, { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` })).status === 400, "Stripe: firma falsa rechazada");
const otra = sesion({ id: "cs_ajena", amount_total: 100 });
await post("/api/pagos/stripe", otra, { "stripe-signature": firmar(otra) });
ok(await estadoS() === "pendiente", "Stripe: una sesión que no es la de la orden (otro id o monto) no aprueba");
ok((await post("/api/pagos/stripe", cuerpo, { "stripe-signature": firmar(cuerpo) })).status === 200, "Stripe: webhook firmado aceptado");
ok(await estadoS() === "aprobado", "Stripe: suscripción aprobada");
const ren = JSON.stringify({ id: "evt_2", type: "invoice.paid", data: { object: { id: "in_renov01", billing_reason: "subscription_cycle", currency: "cop", amount_paid: 13990000, parent: { subscription_details: { subscription: "sub_1" } } } } });
await post("/api/pagos/stripe", ren, { "stripe-signature": firmar(ren) });
await post("/api/pagos/stripe", ren, { "stripe-signature": firmar(ren) });
const renov = (await pool.query(`select estado, vence from pagos_suscripcion where referencia like $1 order by vence`, [refS + "%"])).rows;
ok(renov.length === 2 && renov[1].estado === "aprobado" && renov[1].vence > renov[0].vence, "Stripe: la renovación mensual extiende el periodo una sola vez", String(renov.length));
const fallo = JSON.stringify({ id: "evt_3", type: "invoice.payment_failed", data: { object: { id: "in_fallo01", subscription: "sub_1" } } });
await post("/api/pagos/stripe", fallo, { "stripe-signature": firmar(fallo) });
ok(await estadoS() === "aprobado", "Stripe: un cobro fallido no borra el periodo ya pagado");
const avisoFallo = (await pool.query(`select plantilla, datos from correos where para = 'e@e.co' and clave like 'stripe-fallo:in_fallo01%'`)).rows[0];
ok(avisoFallo?.plantilla === "renovacion_fallida" && !!avisoFallo.datos?.vence, "Stripe: la renovación fallida avisa con su propio correo y la fecha hasta la que sigue el plan", JSON.stringify(avisoFallo));
// Una sola renovación automática por droguería: un pago nuevo (otra suscripción) deja marcada la anterior para cancelarla.
const vecina = "10000000-0000-4000-8000-00000000000b";
await pool.query(`update pagos_suscripcion set empresa_id = $2 where referencia like $1`, [refS + "%", vecina]);
const refS2 = `RG-PRO-PRUEBB${Date.now().toString(36).toUpperCase()}-ABCDEF13`;
await pool.query(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, email, telefono, transaccion, empresa_id) values ($1, 'pro', 'mes', 139900, 'stripe', 'P', 'E', 'e@e.co', '300', 'cs_test_2', $2)`, [refS2, vecina]);
const segunda = JSON.stringify({ id: "evt_4", type: "checkout.session.completed", data: { object: { id: "cs_test_2", mode: "subscription", currency: "cop", amount_total: 13990000, client_reference_id: refS2, payment_status: "paid", subscription: "sub_2" } } });
await post("/api/pagos/stripe", segunda, { "stripe-signature": firmar(segunda) });
const marcas = (await pool.query(`select suscripcion, bool_or(detalle ? 'cancelar_stripe') marcada from pagos_suscripcion where empresa_id = $1 and proveedor = 'stripe' group by 1 order by 1`, [vecina])).rows;
ok(marcas.length === 2 && marcas[0].marcada && !marcas[1].marcada, "Stripe: al pagar otra suscripción, la anterior queda para cancelar (sin doble cobro)", JSON.stringify(marcas));
// Constancia de la contratación: aceptación de términos con versión, fecha e IP.
const acepta = (await pool.query(`select acepta_terminos is not null fecha, version_terminos, ip is not null ip from pagos_suscripcion where referencia = $1`, [j.referencia])).rows[0];
ok(acepta?.fecha && acepta.version_terminos === "2026-11-02" && acepta.ip, "la orden guarda la aceptación de términos (fecha, versión e IP)", JSON.stringify(acepta));
await pool.end();

// ── Pantallas
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

// Las pruebas funcionales entran a la demo sin las ofertas del embudo (las prueba embudo.mjs).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(B + "/contratar?plan=esencial");
ok(await p.getByRole("button", { name: /Esencial/ }).getAttribute("aria-pressed") === "true", "contratar abre con el plan elegido");
await p.getByRole("button", { name: /Anual/ }).click();
ok((await p.getByText("Total a pagar hoy").locator("..").textContent()).includes("899.000"), "anual Esencial = $899.000");
ok(await p.getByText(/QR Bancolombia/).count() >= 1, "ofrece QR Bancolombia");
await p.getByRole("button", { name: /Pagar de forma segura|Ver el QR para pagar/ }).click();
ok(await p.locator("#c-nombre:invalid").count() === 1, "pide los datos antes de pagar");
await p.goto(`${B}/contratar/resultado?ref=${j.referencia}`);
await p.getByText("¡Pago aprobado!").waitFor({ timeout: 10000 });
ok(true, "resultado muestra el pago aprobado");
await p.screenshot({ path: "test-results/pago-aprobado.png" });
ok(errs.length === 0, "sin errores de página", errs.join(" | "));
await b.close(); mock.close();

console.log(fallos ? `\n${fallos} fallo(s)` : "\n0 fallos");
process.exit(fallos ? 1 : 0);
