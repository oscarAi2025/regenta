// Contrato de TODOS los endpoints: cada ruta de src/app/api se prueba sin sesión, desde otro sitio, con el rol que no
// corresponde, con datos basura y con un método que no existe. Nunca debe responder 500 ni dejar ver errores internos.
// Además comprueba que la lista de rutas probadas coincide con las que existen (una ruta nueva sin probar hace fallar).
// Uso: servidor en :4500 (REGENTA_DEMO=1) con la base sembrada → node tests/e2e/endpoints.mjs
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN.email, "Admin Endpoints"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: ADMIN.clave, DATABASE_URL: DB } });
const ra = await fetch(B + "/api/acceso", { method: "POST", headers: { origin: B, "content-type": "application/json", "x-real-ip": IP }, body: JSON.stringify({ ...ADMIN, consola: true }) });
S.admin = ra.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
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
const limpio = (r) => !FUGA.test(r.texto);

// ── Mapa de endpoints. acceso: quién puede; basura: se le mandan datos rotos; rol: [rol sin permiso, estado esperado]
const R = [
  // públicos (con su propia defensa)
  { m: "POST", p: "/api/acceso", acceso: "publico", basura: true },
  { m: "POST", p: "/api/activar", acceso: "publico", basura: true },
  { m: "POST", p: "/api/restablecer", acceso: "publico", basura: true },
  { m: "POST", p: "/api/demo", acceso: "publico", basura: true },
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
  { m: "POST", p: "/api/inventario/costos", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  // control de inventario: ajustes y bajas, kardex, conteo físico (la cajera nunca)
  { m: "GET", p: `/api/inventario/lotes?producto=${U}`, acceso: "sesion", rol: ["cajero", 403] },
  { m: "GET", p: "/api/inventario/lotes?producto=x", acceso: "sesion", espera: 400 },
  { m: "GET", p: "/api/inventario/lotes?vencidos=1", acceso: "sesion" },
  { m: "POST", p: "/api/inventario/ajustes", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: `/api/inventario/kardex?producto=${U}`, acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "GET", p: `/api/inventario/kardex?producto=${U}&formato=csv&desde=x&lote=y`, acceso: "sesion", espera: 400 },
  { m: "GET", p: "/api/inventario/kardex?producto=x", acceso: "sesion", espera: 400 },
  { m: "POST", p: "/api/inventario/conteos", acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "GET", p: `/api/inventario/conteos/${U}`, acceso: "sesion", rol: ["cajero", 403], espera: 404 },
  { m: "GET", p: "/api/inventario/conteos/no-es-uuid", acceso: "sesion", espera: 404 },
  { m: "PATCH", p: `/api/inventario/conteos/${U}`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: `/api/inventario/conteos/${U}/cerrar`, acceso: "sesion", basura: true, rol: ["cajero", 403], espera: 404 },
  { m: "GET", p: "/api/turnos", acceso: "sesion" },
  { m: "POST", p: "/api/turnos", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  { m: "POST", p: `/api/ventas/${U}/devolucion`, acceso: "sesion", basura: true, rol: ["cajero", 403] },
  { m: "POST", p: `/api/ventas/${U}/reenviar`, acceso: "sesion", rol: ["cajero", 403] },
  { m: "DELETE", p: `/api/ventas/${U}`, acceso: "sesion", basura: true },
  { m: "POST", p: "/api/ventas", acceso: "sesion", basura: true, rol: ["bodega", 403] },
  // consola de superadministración
  { m: "POST", p: `/api/admin/clientes/${U}/entrar`, acceso: "admin" },
  { m: "POST", p: `/api/admin/clientes/${U}/numeraciones`, acceso: "admin", basura: true },
  { m: "PATCH", p: `/api/admin/clientes/${U}`, acceso: "admin", basura: true },
  { m: "DELETE", p: `/api/admin/clientes/${U}`, acceso: "admin", basura: true },
  { m: "GET", p: `/api/admin/clientes/${U}/exportar`, acceso: "admin" },
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
const probadas = new Set(R.map((x) => x.p.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|no-es-uuid/g, "*")));
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
  // 4. Petición normal (con sesión): responde algo coherente, nunca 500
  {
    const r = await pedir(e.m, e.p, { cookie: conSesion, cuerpo: ESCRITURA(e.m) ? {} : undefined });
    ok(r.s < 500 || ((e.acceso === "firma" || e.sinConfig) && r.s === 503), `${n}: responde sin error interno`, `${r.s} ${r.texto.slice(0, 120)}`);
    if (e.espera) ok(r.s === e.espera, `${n}: responde ${e.espera}`, String(r.s));
    ok(limpio(r), `${n}: no deja ver detalles internos`, r.texto.slice(0, 160));
    if (!/text\/csv|application\/zip/.test(r.tipo) && r.texto.trim() && !/ndjson/.test(r.tipo)) ok(/json/.test(r.tipo), `${n}: responde JSON`, r.tipo);
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
// ── Una sesión falsificada no entra
{
  const r = await pedir("GET", "/api/productos?q=a", { cookie: "regenta_sesion=eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiJ4In0.firmafalsa" });
  ok(r.s === 401, "una cookie de sesión falsificada no sirve", String(r.s));
}

console.log(`\n${casos} comprobaciones · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
