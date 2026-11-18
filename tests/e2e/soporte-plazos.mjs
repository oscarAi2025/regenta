// Documento soporte · plazos (auditoría P1-5, Res. DIAN 167/2021 art. 10 par.): una compra registrada a un proveedor no
// obligado a facturar y sin documento soporte aparece en Inicio («compras sin documento soporte») y el dueño recibe un aviso
// con el plazo (viernes de la semana de la compra); el aviso no se repite en cada pasada; al generar el soporte desaparece.
// Uso: servidor con REGENTA_CRON_KEY → node tests/e2e/soporte-plazos.mjs
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const CRON = process.env.REGENTA_CRON_KEY ?? "cron-prueba-0123456789abcdef0123456789";
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const E = "10000000-0000-4000-8000-00000000000a", S = "20000000-0000-4000-8000-00000000000a", CARLOS = "00000000-0000-4000-8000-000000000001";
const tareas = () => fetch(B + "/api/tareas?operacion=1", { method: "POST", headers: { authorization: `Bearer ${CRON}` } }).then((r) => r.json());
const sesion = async () => (await fetch(B + "/api/sesion", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify({ uid: CARLOS }) })).headers.get("set-cookie").split(";")[0];

// Proveedor no obligado y una compra registrada sin soporte; la demo pasa a «real» durante la prueba (sin la marca demo no
// se avisa) y se le da un dueño con correo.
const DUENO = crypto.randomUUID(), CORREO = `soporte${Date.now()}@prueba.test`;
const ck = await sesion();   // la entrada de demo solo funciona con la marca demo puesta
await q(`update empresas set demo = false where id = $1`, [E]);
try {
  await q(`insert into cuentas (id, email, nombre, clave_hash) values ($1, $2, 'Dueño soporte', 'x:y')`, [DUENO, CORREO]);
  await q(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Dueño soporte', 'dueno')`, [E, DUENO]);
  const prov = (await q(`insert into proveedores (empresa_id, nombre, nit, obligado_facturar) values ($1, 'Campesino de prueba ' || $2, $2, false) returning id`, [E, String(Date.now()).slice(-9)]))[0].id;
  const num = Number((await q(`select coalesce(max(numero), 0) + 1 n from compras where empresa_id = $1`, [E]))[0].n);
  const compra = (await q(`insert into compras (empresa_id, sede_id, numero, proveedor_id, numero_factura, fecha_factura, vence_pago, subtotal, total, estado, usuario_id)
    values ($1, $2, $3, $4, 'CTA-1', current_date - 1, current_date - 1, 50000, 50000, 'registrada', $5) returning id`, [E, S, num, prov, CARLOS]))[0].id;

  // Inicio (como el dueño de la demo)
  const html = (await (await fetch(B + "/inicio", { headers: { cookie: ck } })).text()).replace(/<!--.*?-->/g, "");
  ok(/(\d+)<\/span><span[^>]*>compras sin documento soporte/.test(html) && !/>0<\/span><span[^>]*>compras sin documento soporte/.test(html), "Inicio: alerta de compras sin documento soporte");

  // Aviso por correo con el plazo; no se repite
  let t = await tareas();
  ok(t.soporte?.compras >= 1, "la tarea encuentra la compra pendiente", JSON.stringify(t.soporte));
  const avisos = await q(`select datos from correos where para = $1 and plantilla = 'soporte_pendiente'`, [CORREO]);
  ok(avisos.length === 1 && /Campesino de prueba/.test(avisos[0].datos.lista) && /plazo \d\d\/\d\d\/\d{4}/.test(avisos[0].datos.lista), "el dueño recibe el aviso con la compra y su plazo", JSON.stringify(avisos[0]?.datos ?? {}));
  t = await tareas();
  ok((await q(`select count(*)::int n from correos where para = $1 and plantilla = 'soporte_pendiente'`, [CORREO]))[0].n === 1, "el aviso no se repite en la siguiente pasada");

  // Un proveedor obligado a facturar no cuenta
  await q(`update proveedores set obligado_facturar = true where id = $1`, [prov]);
  t = await tareas();
  ok(!(t.soporte?.compras >= 1) || !(await q(`select 1 from correos where para = $1 and plantilla = 'soporte_pendiente' and creado > now() - interval '5 seconds'`, [CORREO])).length, "proveedor obligado a facturar: no pide soporte");
  await q(`update proveedores set obligado_facturar = false where id = $1`, [prov]);

  // Compra anulada (o ya soportada): sale de la lista
  await q(`update compras set estado = 'anulada', motivo_anulacion = 'Prueba de plazos' where id = $1`, [compra]);
  const despues = (await (await fetch(B + "/inicio", { headers: { cookie: ck } })).text()).replace(/<!--.*?-->/g, "");
  ok(/>0<\/span><span[^>]*>compras sin documento soporte/.test(despues), "sin compras pendientes, la alerta queda en cero");
} finally {
  await q(`delete from miembros where user_id = $1`, [DUENO]).catch(() => {});
  await q(`delete from cuentas where id = $1`, [DUENO]).catch(() => {});
  await q(`update empresas set demo = true where id = $1`, [E]);
}
await pool.end();
console.log(`\n${fallos ? `${fallos} fallos` : "Todo en verde"}`);
process.exit(fallos ? 1 : 0);
