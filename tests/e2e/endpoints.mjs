// Contrato de TODOS los endpoints: cada ruta de src/app/api se prueba sin sesión, desde otro sitio, con el rol que no
// corresponde, con datos basura y con un método que no existe. Nunca debe responder 500 ni dejar ver errores internos.
// Además comprueba que la lista de rutas probadas coincide con las que existen (una ruta nueva sin probar hace fallar).
// Uso: servidor en :4500 (REGENTA_DEMO=1) con la base sembrada → node tests/e2e/endpoints.mjs
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import pg from "pg";
import { codigoTotp, TOTP } from "../ayudas/totp.mjs";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
let fallos = 0, casos = 0;
const ok = (c, m, x = "") => { casos++; if (!c) { console.log(`FAIL ${m}${x ? " — " + x : ""}`); fallos++; } };
const U = crypto.randomUUID();
const IP = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const AJENO = "https://atacante.example";

// ── Sesiones: dueño, cajera y bodega de la demo; superadministrador real
async function sesion(rol) {
  const r = await fetch(B + "/demo", { method: "POST", headers: { origin: B, "content-type": "application/x-www-form-urlencoded", "x-real-ip": IP }, body: `rol=${rol}`, redirect: "manual" });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const S = { dueno: await sesion("dueno"), cajero: await sesion("cajero"), bodega: await sesion("bodega") };
const ADMIN = { email: `ep${Date.now().toString().slice(-7)}@regenta.test`, clave: "ConsolaEndpoints2026" };
execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN.email, "Admin Endpoints"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: ADMIN.clave, REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });
const ra = await fetch(B + "/api/acceso", { method: "POST", headers: { origin: B, "content-type": "application/json", "x-real-ip": IP }, body: JSON.stringify({ ...ADMIN, consola: true, codigo: codigoTotp() }) });
S.admin = ra.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
// Vendedor (rol del mostrador; la demo no lo trae): miembro de la droguería demo con sesión firmada como la de /api/acceso.
{
  const pool = new pg.Pool({ connectionString: DB });
  const VEND = "00000000-0000-4000-8000-0000000000e8";
  const emp = (await pool.query(`select id from empresas where demo limit 1`)).rows[0].id;
  await pool.query(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Vendedor endpoints', 'vendedor')
    on conflict (empresa_id, user_id) do update set activo = true, rol = 'vendedor'`, [emp, VEND]);
  await pool.end();
  const jwt = await new SignJWT({ uid: VEND, empresa: emp, nombre: "Vendedor endpoints", rol: "vendedor", v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef"));
  S.vendedor = `regenta_sesion=${jwt}`;
}
ok(ra.ok && S.admin.includes("="), "el superadministrador entra a la consola", String(ra.status));

async function pedir(metodo, ruta, { cookie = "", origen = B, cuerpo, crudo, cabeceras = {} } = {}) {
  const h = { "x-real-ip": IP, ...cabeceras };
  if (cookie) h.cookie = cookie;
  if (origen) h.origin = origen;
  let body;
  if (crudo !== undefined) { body = crudo; h["content-type"] = "application/json"; }
  else if (cuerpo !== undefined) { body = JSON.stringify(cuerpo); h["content-type"] = "application/json"; }
  const r = await fetch(B + ruta, { method: metodo, headers: h, body, redirect: "manual" });
  const texto = await r.text();
  return { s: r.status, texto, tipo: r.headers.get("content-type") ?? "" };
}
// Nada de lo que vea un cliente puede delatar el interior: trazas, SQL, rutas del servidor.
const FUGA = /\bat .+\.(js|ts):\d+|relation "|column "|syntax error|violates|duplicate key|ECONN|node_modules|\/home\/|stack|pg_|SELECT |INSERT /i;
// Un ZIP (y un Excel .xlsx, que es un ZIP) es binario comprimido: sus bytes pueden formar «pg_» al azar (falso positivo); no se revisa como texto.
const BINARIO = /application\/zip|spreadsheetml/;
const limpio = (r) => BINARIO.test(r.tipo) || !FUGA.test(r.texto);

// ── Mapa de endpoints. acceso: quién puede; basura: se le mandan datos rotos; rol: [rol sin permiso, estado esperado]
const R = [
  // públicos (con su propia defensa)
  { m: "POST", p: "/api/acceso", acceso: "publico", basura: true },
  { m: "POST", p: "/api/activar", acceso: "publico", basura: true },
  { m: "POST", p: "/api/restablecer", acceso: "publico", basura: true },
  { m: "POST", p: "/api/demo", acceso: "publico", basura: true },
  { m: "POST", p: "/api/demo/evento", acceso: "sesion", basura: true },
  { m: "POST", p: "/api/pagos", acceso: "publico", basura: true },
  { m: "GET", p: "/api/pagos/estado?ref=RG-X-1-ABCDEF12", acceso: "publico" },
  { m: "GET", p: "/api/pagos/estado?ref=hola", acceso: "publico", espera: 400 },
  { m: "POST", p: "/api/correo/baja?t=falso", acceso: "publico", espera: 400 },
  { m: "POST", p: "/api/sesion", acceso: "publico", basura: true },
  { m: "DELETE", p: "/api/sesion", acceso: "publico" },
  { m: "POST", p: "/api/admin/salir", acceso: "publico" },
  { m: "POST", p: "/api/admin/activar", acceso: "publico", basura: true },
  { m: "POST", p: "/api/activar/nuevo", acceso: "publico", basura: true },
  // firmados por la pasarela / tarea programada
  { m: "POST", p: "/api/pagos/stripe", acceso: "firma", basura: true },
  { m: "POST", p: "/api/pagos/wompi", acceso: "firma", basura: true },
  { m: "POST", p: "/api/tareas", acceso: "cron" },
  { m: "POST", p: "/api/dian", acceso: "cron" },
  { m: "POST", p: "/api/invima", acceso: "cron" },
  // con sesión de droguería
  { m: "POST", p: "/api/alertas", acceso: "sesion", basura: true },
  { m: "POST", p: "/api/cartera", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "DELETE", p: `/api/cartera/${U}`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "DELETE", p: "/api/cartera/no-es-uuid", acceso: "sesion" },
  { m: "GET", p: "/api/clientes?q=a", acceso: "sesion", rol: ["bodega", 403] },
  { m: "POST", p: "/api/clientes", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "GET", p: "/api/cajas", acceso: "sesion" },
  { m: "POST", p: "/api/cajas", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "PATCH", p: "/api/cajas", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "PATCH", p: "/api/configuracion", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: "/api/equipo", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "PATCH", p: "/api/equipo", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: "/api/ia", acceso: "sesion", basura: true, sinConfig: true }, // sin clave de IA en el servidor: 503 legible
  { m: "POST", p: "/api/inventario", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: "/api/maestro?q=acetaminofen", acceso: "sesion" },
  { m: "PATCH", p: `/api/productos/${U}`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "PATCH", p: "/api/productos/no-es-uuid", acceso: "sesion" },
  { m: "GET", p: `/api/productos/alternativas?id=${U}`, acceso: "sesion" },
  { m: "GET", p: "/api/productos/alternativas?id=x", acceso: "sesion" },
  { m: "POST", p: "/api/productos/importar", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: "/api/productos?q=a", acceso: "sesion" },
  { m: "POST", p: "/api/productos", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: "/api/reportes?tipo=productos", acceso: "sesion", rol: ["cajero", 403] },
  { m: "GET", p: "/api/reportes?tipo=nada", acceso: "sesion", espera: 400 },
  { m: "GET", p: "/api/reportes?desde=x&hasta=y", acceso: "sesion" },
  { m: "POST", p: "/api/suscripcion", acceso: "sesion", rol: ["cajero", 403] },
  { m: "GET", p: "/api/exportar", acceso: "sesion", rol: ["cajero", 403] },
  { m: "POST", p: "/api/cuenta", acceso: "sesion", basura: true },
  { m: "PATCH", p: `/api/clientes/${U}`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: `/api/clientes/${U}/correo`, acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "POST", p: "/api/inventario/costos", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  // control de inventario: ajustes y bajas, kardex, conteo físico (la cajera nunca)
  { m: "GET", p: `/api/inventario/lotes?producto=${U}`, acceso: "sesion", rol: ["cajero", 403] },
  { m: "GET", p: "/api/inventario/lotes?producto=x", acceso: "sesion", espera: 400 },
  { m: "GET", p: "/api/inventario/lotes?vencidos=1", acceso: "sesion" },
  { m: "GET", p: "/api/inventario/exportar", acceso: "sesion" },
  { m: "GET", p: "/api/ventas/historial/exportar?desde=2026-13-01&hasta=2026-02-30&q=x", acceso: "sesion", rol: ["cajero", 403] },
  { m: "PUT", p: "/api/empresa/factura", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "PUT", p: "/api/empresa/logo", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "PUT", p: `/api/admin/clientes/${U}/logo`, acceso: "admin", basura: true },
  { m: "PATCH", p: `/api/inventario/lotes/${U}`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: "/api/inventario/ajustes", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: `/api/inventario/kardex?producto=${U}`, acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "GET", p: `/api/inventario/kardex?producto=${U}&formato=excel&desde=x&lote=y`, acceso: "sesion", espera: 400 },
  { m: "GET", p: "/api/inventario/kardex?producto=x", acceso: "sesion", espera: 400 },
  { m: "POST", p: "/api/inventario/conteos", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: `/api/inventario/conteos/${U}`, acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "GET", p: "/api/inventario/conteos/no-es-uuid", acceso: "sesion", espera: 404 },
  { m: "PATCH", p: `/api/inventario/conteos/${U}`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: `/api/inventario/conteos/${U}/cerrar`, acceso: "sesion", basura: true, rol: ["cajero", 403], espera: 404 },
  { m: "DELETE", p: `/api/inventario/conteos/${U}`, acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "GET", p: "/api/turnos", acceso: "sesion" },
  { m: "POST", p: "/api/turnos", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "POST", p: `/api/ventas/${U}/devolucion`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: `/api/ventas/${U}/reenviar`, acceso: "sesion", rol: ["cajero", 403] },
  { m: "DELETE", p: `/api/ventas/${U}`, acceso: "sesion", basura: true },
  { m: "POST", p: "/api/ventas", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "GET", p: "/api/documentos?estado=rechazado", acceso: "sesion", rol: ["cajero", 403] },
  { m: "GET", p: "/api/documentos?desde=x&hasta=y&pagina=-5&tipo=nada", acceso: "sesion" },
  // Bloque 3-B · DIAN complementaria: documento soporte, nota de ajuste, nota débito y XML (dueño/admin)
  { m: "GET", p: `/api/dian/soporte?compra=${U}`, acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "GET", p: "/api/dian/soporte?compra=no-es-uuid", acceso: "sesion", espera: 400 },
  { m: "POST", p: "/api/dian/soporte", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "POST", p: `/api/dian/soporte/${U}/ajuste`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: `/api/dian/nota-debito?factura=${U}`, acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "POST", p: "/api/dian/nota-debito", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "GET", p: `/api/documentos/${U}/xml`, acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "POST", p: `/api/documentos/${U}/reenviar`, acceso: "sesion", rol: ["bodega", 403], espera: 404 },
  { m: "GET", p: "/api/documentos/xml?desde=2025-01-01&hasta=2025-01-01", acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "GET", p: "/api/temperatura?mes=2026-13", acceso: "sesion", rol: ["cajero", 403] },
  { m: "POST", p: "/api/temperatura", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "PATCH", p: "/api/temperatura", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "GET", p: "/api/control-especial", acceso: "sesion", rol: ["cajero", 403] },
  { m: "GET", p: "/api/control-especial?formato=excel&desde=x&hasta=y", acceso: "sesion", rol: ["bodega", 403] },
  { m: "GET", p: "/api/control-especial?producto=x", acceso: "sesion", espera: 400 },
  { m: "PATCH", p: "/api/control-especial", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  // Bloque 2-A · compras, proveedores y cuentas por pagar (dueño/admin/bodega; dinero solo dueño/admin)
  { m: "GET", p: "/api/compras", acceso: "sesion", rol: ["cajero", 403], vendedor: 403 },
  { m: "POST", p: "/api/compras", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: "/api/compras/leer-factura", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: `/api/compras/${U}`, acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "GET", p: "/api/compras/no-es-uuid", acceso: "sesion", espera: 400 },
  { m: "PATCH", p: `/api/compras/${U}`, acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "DELETE", p: `/api/compras/${U}`, acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "POST", p: "/api/compras/pagos", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "DELETE", p: "/api/compras/pagos", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "POST", p: "/api/compras/devoluciones", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "PATCH", p: "/api/compras/devoluciones", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "GET", p: "/api/proveedores", acceso: "sesion", rol: ["cajero", 403], vendedor: 403 },
  { m: "GET", p: `/api/proveedores?id=${U}`, acceso: "sesion", espera: 404 },
  { m: "GET", p: "/api/proveedores?id=x", acceso: "sesion", espera: 400 },
  { m: "POST", p: "/api/proveedores", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "PATCH", p: "/api/proveedores", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "GET", p: "/api/cuentas-por-pagar", acceso: "sesion", rol: ["bodega", 403] },
  { m: "GET", p: "/api/cuentas-por-pagar?formato=excel", acceso: "sesion", rol: ["cajero", 403] },
  // Bloque 2-B · mostrador: pedidos (dueño/admin/cajera/vendedor; la bodega no) y cobrar (el vendedor tampoco)
  { m: "GET", p: "/api/pedidos", acceso: "sesion", rol: ["bodega", 403] },
  { m: "POST", p: "/api/pedidos", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "GET", p: `/api/pedidos/${U}`, acceso: "sesion", rol: ["bodega", 403], espera: 404 },
  { m: "GET", p: "/api/pedidos/no-es-uuid", acceso: "sesion", espera: 404 },
  { m: "PATCH", p: `/api/pedidos/${U}`, acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "POST", p: `/api/pedidos/${U}/cobrar`, acceso: "sesion", basura: true, rol: ["bodega", 403], vendedor: 403 },
  // Bloque 2-C · cuentas de clientes: crédito, recibos de caja y cartera por cliente
  { m: "GET", p: `/api/clientes/${U}/credito?valor=1000`, acceso: "sesion", rol: ["bodega", 403], espera: 404, vendedor: 403 },
  { m: "GET", p: `/api/clientes/${U}/credito?valor=abc`, acceso: "sesion", espera: 400 },
  { m: "PATCH", p: `/api/clientes/${U}/credito`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: "/api/recibos?q=a", acceso: "sesion", rol: ["bodega", 403], vendedor: 403 },
  { m: "POST", p: "/api/recibos", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "DELETE", p: "/api/recibos/999999999", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "DELETE", p: "/api/recibos/no-es-uuid", acceso: "sesion", espera: 404 },
  { m: "GET", p: "/api/cartera", acceso: "sesion", rol: ["cajero", 403] },
  { m: "GET", p: "/api/cartera?formato=excel&edad=e0&q=a", acceso: "sesion", rol: ["cajero", 403] },
  { m: "GET", p: "/api/cartera?edad=nada", acceso: "sesion", espera: 400 },
  { m: "PATCH", p: "/api/cartera", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  // Bloque 3-A · resultados, IVA, cierre del día, gastos y bitácora (dueño/admin)
  { m: "GET", p: "/api/reportes/resultados?desde=2026-13-01&formato=excel", acceso: "sesion", rol: ["cajero", 403], vendedor: 403 },
  { m: "GET", p: "/api/reportes/iva?formato=excel&desde=x", acceso: "sesion", rol: ["bodega", 403] },
  { m: "GET", p: "/api/reportes/cierre?fecha=2026-13-45", acceso: "sesion", rol: ["cajero", 403] },
  { m: "GET", p: "/api/gastos?formato=excel&categoria=zz", acceso: "sesion", rol: ["cajero", 403], vendedor: 403 },
  { m: "POST", p: "/api/gastos", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "DELETE", p: "/api/gastos", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "GET", p: "/api/bitacora?pagina=-1&tipo=nada", acceso: "sesion", rol: ["cajero", 403], vendedor: 403 },
  // Bloque 3-C · precios en bloque (dueño/admin), etiquetas y cuarentena (dueño/admin/bodega), códigos alternos
  { m: "GET", p: "/api/precios", acceso: "sesion", rol: ["cajero", 403], vendedor: 403 },
  { m: "POST", p: "/api/precios", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "POST", p: "/api/precios/vista-previa", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: `/api/precios/${U}`, acceso: "sesion", rol: ["bodega", 403], espera: 404 },
  { m: "GET", p: "/api/precios/no-es-uuid", acceso: "sesion", espera: 404 },
  { m: "POST", p: `/api/precios/${U}/revertir`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: "/api/etiquetas?compra=abc", acceso: "sesion", rol: ["cajero", 403], espera: 400, vendedor: 403 },
  { m: "GET", p: "/api/etiquetas?compra=999999999", acceso: "sesion", espera: 404 },
  { m: "GET", p: "/api/inventario/cuarentena", acceso: "sesion", rol: ["cajero", 403], vendedor: 403 },
  { m: "POST", p: "/api/inventario/cuarentena", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "PATCH", p: "/api/inventario/cuarentena", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "POST", p: "/api/inventario/cuarentena/liberar", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: "/api/inventario/cuarentena/baja", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: `/api/productos/${U}/codigos`, acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "POST", p: `/api/productos/${U}/codigos`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "DELETE", p: `/api/productos/${U}/codigos`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: `/api/ventas/${U}/devolucion`, acceso: "sesion", rol: ["cajero", 403] }, // devuelve el destino por defecto de la droguería (no lee la venta)
  // consola de superadministración
  { m: "POST", p: `/api/admin/clientes/${U}/entrar`, acceso: "admin" },
  { m: "POST", p: `/api/admin/clientes/${U}/numeraciones`, acceso: "admin", basura: true },
  { m: "PATCH", p: `/api/admin/clientes/${U}`, acceso: "admin", basura: true },
  { m: "POST", p: "/api/admin/dos-pasos", acceso: "admin", basura: true },
  { m: "DELETE", p: `/api/admin/clientes/${U}`, acceso: "admin", basura: true },
  { m: "GET", p: `/api/admin/clientes/${U}/exportar`, acceso: "admin" },
  { m: "GET", p: `/api/admin/clientes/${U}/habilitacion`, acceso: "admin" },
  { m: "POST", p: `/api/admin/clientes/${U}/habilitacion`, acceso: "admin", basura: true },
  { m: "POST", p: `/api/admin/clientes/${U}/migracion`, acceso: "admin", basura: true },
  { m: "POST", p: `/api/admin/clientes/${U}/pagos`, acceso: "admin", basura: true },
  { m: "PATCH", p: "/api/admin/cargos", acceso: "admin", basura: true },
  { m: "POST", p: `/api/admin/clientes/${U}/usuarios`, acceso: "admin", basura: true },
  { m: "PATCH", p: `/api/admin/clientes/${U}/usuarios`, acceso: "admin", basura: true },
  { m: "POST", p: "/api/admin/clientes", acceso: "admin", basura: true },
  { m: "PATCH", p: "/api/admin/correos", acceso: "admin", basura: true },
  { m: "PATCH", p: "/api/admin/pagos", acceso: "admin", basura: true },
  { m: "POST", p: "/api/admin/sistema", acceso: "admin", basura: true },
  { m: "PATCH", p: "/api/admin/solicitudes", acceso: "admin", basura: true },
];

// ── ¿Falta probar alguna ruta? (las rutas nuevas tienen que entrar en el mapa)
function rutas(dir, base = "") {
  const out = [];
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...rutas(f, `${base}/${n}`));
    else if (n === "route.ts") out.push(base || "/");
  }
  return out;
}
const existentes = rutas("src/app/api").map((r) => "/api" + r.replace(/\[[^\]]+\]/g, "*"));
const probadas = new Set(R.map((x) => x.p.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|no-es-uuid|(?<=\/)\d+(?=\/|$)/g, "*")));
const sinProbar = existentes.filter((e) => !probadas.has(e));
ok(sinProbar.length === 0, "todas las rutas de la API están en el contrato", sinProbar.join(", "));

const BASURA = [undefined, "", "no es json", "null", "[]", "{}", '{"a":', JSON.stringify({ email: "x".repeat(5000), nombre: 1, valor: -1, id: "1; drop table ventas", lineas: "x", filas: [null] })];
const ESCRITURA = (m) => m !== "GET";

for (const e of R) {
  const n = `${e.m} ${e.p}`;
  const conSesion = e.acceso === "sesion" ? S.dueno : e.acceso === "admin" ? S.admin : "";
  // 1. Sin credenciales
  if (["sesion", "admin", "cron", "firma"].includes(e.acceso)) {
    const r = await pedir(e.m, e.p, { cuerpo: ESCRITURA(e.m) ? {} : undefined });
    const esperado = e.acceso === "firma" ? [400, 401, 503] : e.acceso === "admin" ? [401, 403] : [401];
    ok(esperado.includes(r.s), `${n}: sin credenciales se rechaza`, `${r.s} ${r.texto.slice(0, 80)}`);
  }
  // 2. Desde otro sitio (CSRF): con la sesión válida pero origen ajeno, toda escritura se rechaza
  if (ESCRITURA(e.m) && ["sesion", "admin"].includes(e.acceso)) {
    const r = await pedir(e.m, e.p, { cookie: conSesion, origen: AJENO, cuerpo: {} });
    ok(r.s === 403, `${n}: desde otro sitio se rechaza`, String(r.s));
  }
  if (ESCRITURA(e.m) && e.acceso === "publico" && !["/api/correo/baja"].some((x) => e.p.startsWith(x))) {
    const r = await pedir(e.m, e.p, { origen: AJENO, cuerpo: {} });
    ok(r.s === 403, `${n}: desde otro sitio se rechaza`, String(r.s));
  }
  // 3. Rol sin permiso
  if (e.rol) {
    const r = await pedir(e.m, e.p, { cookie: S[e.rol[0]], cuerpo: ESCRITURA(e.m) ? {} : undefined });
    ok(r.s === e.rol[1] || (e.rol[1] === 403 && r.s === 400 && /permiso|solo el|solo la/i.test(r.texto)), `${n}: ${e.rol[0]} no tiene permiso`, `${r.s} ${r.texto.slice(0, 100)}`);
  }
  if (e.vendedor) {
    const r = await pedir(e.m, e.p, { cookie: S.vendedor, cuerpo: ESCRITURA(e.m) ? {} : undefined });
    ok(r.s === e.vendedor, `${n}: el vendedor no tiene permiso`, `${r.s} ${r.texto.slice(0, 100)}`);
  }
  // 4. Petición normal (con sesión): responde algo coherente, nunca 500
  {
    const r = await pedir(e.m, e.p, { cookie: conSesion, cuerpo: ESCRITURA(e.m) ? {} : undefined });
    ok(r.s < 500 || ((e.acceso === "firma" || e.sinConfig) && r.s === 503), `${n}: responde sin error interno`, `${r.s} ${r.texto.slice(0, 120)}`);
    if (e.espera) ok(r.s === e.espera, `${n}: responde ${e.espera}`, String(r.s));
    ok(limpio(r), `${n}: no deja ver detalles internos`, r.texto.slice(0, 160));
    if (!/text\/csv/.test(r.tipo) && !BINARIO.test(r.tipo) && r.texto.trim() && !/ndjson/.test(r.tipo)) ok(/json/.test(r.tipo), `${n}: responde JSON`, r.tipo);
  }
  // 5. Datos basura: siempre 4xx (o el flujo propio), jamás 500 ni fugas
  if (e.basura) for (const crudo of BASURA) {
    const r = await pedir(e.m, e.p, { cookie: conSesion, crudo: crudo });
    ok(r.s < 500 || ((e.acceso === "firma" || e.sinConfig) && r.s === 503), `${n}: datos basura (${String(crudo).slice(0, 12)}) sin error interno`, `${r.s} ${r.texto.slice(0, 120)}`);
    ok(limpio(r), `${n}: datos basura sin fugas`, r.texto.slice(0, 160));
  }
  // 6. Método que no existe
  {
    const otro = e.m === "GET" ? "PUT" : "GET";
    if (!R.some((x) => x.p.split("?")[0] === e.p.split("?")[0] && x.m === otro)) {
      const r = await pedir(otro, e.p, { cookie: conSesion });
      ok([404, 405].includes(r.s), `${n}: el método ${otro} no existe`, String(r.s));
    }
  }
}

// ── La tarea programada con la clave correcta sí funciona; con una casi igual, no
{
  const CRON = process.env.REGENTA_CRON_KEY ?? "cron-prueba-0123456789abcdef0123456789";
  const bien = await pedir("POST", "/api/tareas", { cabeceras: { authorization: `Bearer ${CRON}` } });
  ok(bien.s === 200 && /recordatorios/.test(bien.texto), "la tarea programada funciona con su clave", String(bien.s));
  const casi = await pedir("POST", "/api/tareas", { cabeceras: { authorization: `Bearer ${CRON.slice(0, -1)}x` } });
  ok(casi.s === 401, "una clave casi igual no sirve");
}
// ── El vendedor sí arma pedidos (su sesión sirve) pero no cobra ni vende: 403 aunque el cuerpo sea válido
{
  ok((await pedir("GET", "/api/pedidos", { cookie: S.vendedor })).s === 200, "el vendedor lista los pedidos");
  const venta = { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: U, presentacion: "caja", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1000 }] };
  ok((await pedir("POST", "/api/ventas", { cookie: S.vendedor, cuerpo: venta })).s === 403, "el vendedor no vende en la caja (403)");
  ok((await pedir("POST", `/api/pedidos/${U}/cobrar`, { cookie: S.vendedor, cuerpo: venta })).s === 403, "el vendedor no cobra pedidos (403)");
  // Con un cuerpo válido, un pedido que no es de la droguería es 404 (no 400 ni 500).
  ok((await pedir("POST", `/api/pedidos/${U}/cobrar`, { cookie: S.dueno, cuerpo: venta })).s === 404, "cobrar un pedido ajeno o inexistente: 404");
}
// ── Una sesión falsificada no entra
{
  const r = await pedir("GET", "/api/productos?q=a", { cookie: "regenta_sesion=eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiJ4In0.firmafalsa" });
  ok(r.s === 401, "una cookie de sesión falsificada no sirve", String(r.s));
}

console.log(`\n${casos} comprobaciones · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
