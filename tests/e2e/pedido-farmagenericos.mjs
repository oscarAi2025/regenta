// «Te falta X → pídelo a Farmagenéricos» (21/11/2026). Con el aviso encendido: Inicio e Inventario avisan y llevan al
// pedido sugerido, que trae el botón «Pedir a Farmagenéricos»; el pedido queda guardado con los productos y cajas pedidos
// y devuelve el WhatsApp de Farmagenéricos con el pedido escrito. La cajera no pide; un producto de otra droguería no
// entra; apagado en Equipo, no hay aviso, ni botón, y la API lo rechaza. La caja no cambia.
// Uso: servidor en marcha → node tests/e2e/pedido-farmagenericos.mjs
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const E = "10000000-0000-4000-8000-00000000000a", EB = "10000000-0000-4000-8000-00000000000b";
const U = { carlos: "00000000-0000-4000-8000-000000000001", cajera: "00000000-0000-4000-8000-000000000002", bodega: "00000000-0000-4000-8000-000000000003" };
const sesion = async (uid) => (await fetch(B + "/api/sesion", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify({ uid }) })).headers.get("set-cookie").split(";")[0];
const ver = async (ck, ruta) => { const r = await fetch(B + ruta, { headers: { cookie: ck, origin: B }, redirect: "manual" }); return { s: r.status, t: (await r.text()).replace(/<!--.*?-->/g, "") }; };
const pedir = async (ck, lineas) => { const r = await fetch(B + "/api/pedidos-farmagenericos", { method: "POST", headers: { cookie: ck, origin: B, "content-type": "application/json" }, body: JSON.stringify({ lineas }) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };

const antes = (await q(`select pedir_farmagenericos from empresas where id = $1`, [E]))[0].pedir_farmagenericos;
try {
  const carlos = await sesion(U.carlos), bodega = await sesion(U.bodega), cajera = await sesion(U.cajera);
  ok(antes === true, "el aviso viene encendido por defecto");

  // ── Encendido: avisos y botón
  const ini = await ver(carlos, "/inicio");
  ok(ini.s === 200 && /pídelos a Farmagenéricos/.test(ini.t) && /\/prediccion\?ver=pedido/.test(ini.t), "Inicio: «Te estás quedando sin N productos: pídelos a Farmagenéricos» lleva al pedido sugerido");
  const inv = await ver(carlos, "/inventario");
  ok(inv.s === 200 && /Se te están acabando productos que vendes: pídelos a Farmagenéricos/.test(inv.t) && /Armar el pedido/.test(inv.t), "Inventario: aviso con «Armar el pedido»");
  const pred = await ver(carlos, "/prediccion?ver=pedido");
  ok(pred.s === 200 && /Pedir a Farmagenéricos/.test(pred.t) && /Enviar a otro proveedor/.test(pred.t), "Pedido sugerido: botón «Pedir a Farmagenéricos» y el WhatsApp queda para otro proveedor");

  // ── El pedido se guarda con lo pedido y devuelve el WhatsApp de Farmagenéricos
  const prods = await q(`select id, nombre from productos where empresa_id = $1 and activo order by nombre limit 2`, [E]);
  const nAntes = (await q(`select count(*)::int n from pedidos_farmagenericos where empresa_id = $1`, [E]))[0].n;
  const r = await pedir(bodega, [{ producto_id: prods[0].id, cajas: 3 }, { producto_id: prods[1].id, cajas: 2 }, { producto_id: prods[0].id, cajas: 1 }]);
  ok(r.s === 201 && r.j.productos === 2 && r.j.cajas === 6, "la bodega pide: 2 productos y 6 cajas (las líneas repetidas se suman)", JSON.stringify(r.j).slice(0, 120));
  const texto = decodeURIComponent((r.j.whatsapp ?? "").split("?text=")[1] ?? "");
  ok((r.j.whatsapp ?? "").startsWith("https://wa.me/573212141970?text="), "abre el WhatsApp de Farmagenéricos");
  ok(texto.includes(`• 4 × ${prods[0].nombre}`) && texto.includes(`• 2 × ${prods[1].nombre}`) && /NIT \d/.test(texto), "el mensaje lleva la droguería con su NIT y cada producto con sus cajas", texto.split("\n")[0]);
  const fila = (await q(`select productos, cajas, usuario_id, jsonb_array_length(lineas) n from pedidos_farmagenericos where empresa_id = $1 order by id desc limit 1`, [E]))[0];
  ok((await q(`select count(*)::int n from pedidos_farmagenericos where empresa_id = $1`, [E]))[0].n === nAntes + 1 && fila.productos === 2 && fila.cajas === 6 && fila.n === 2 && fila.usuario_id === U.bodega,
    "queda guardado: productos, cajas y quién pidió");

  // ── Permisos y datos ajenos
  ok((await pedir(cajera, [{ producto_id: prods[0].id, cajas: 1 }])).s === 403, "la cajera no hace pedidos (403)");
  // Un producto de otra droguería (si la semilla no trae ninguno, uno que no existe: la respuesta es la misma).
  const ajeno = (await q(`select id from productos where empresa_id = $1 limit 1`, [EB]))[0]?.id ?? crypto.randomUUID();
  const r2 = await pedir(carlos, [{ producto_id: ajeno, cajas: 1 }]);
  ok(r2.s === 400 && /no es de tu droguería/.test(r2.j.error ?? ""), "un producto de otra droguería no entra", r2.j.error);
  ok((await pedir(carlos, [])).s === 400 && (await pedir(carlos, [{ producto_id: prods[0].id, cajas: 0 }])).s === 400, "sin productos o con 0 cajas no se envía");
  const caj = await ver(cajera, "/prediccion?ver=pedido");
  ok(caj.s !== 200 || !/Pedir a Farmagenéricos/.test(caj.t), "la cajera no ve el botón");

  // ── Apagado: sin aviso, sin botón y la API lo rechaza
  await q(`update empresas set pedir_farmagenericos = false where id = $1`, [E]);
  ok(!/pídelos a Farmagenéricos/.test((await ver(carlos, "/inicio")).t), "apagado: Inicio sin el aviso");
  ok(!/pídelos a Farmagenéricos/.test((await ver(carlos, "/inventario")).t), "apagado: Inventario sin el aviso");
  const p2 = (await ver(carlos, "/prediccion?ver=pedido")).t;
  ok(!/Pedir a Farmagenéricos/.test(p2) && /Enviar por WhatsApp/.test(p2), "apagado: el pedido sugerido vuelve a «Enviar por WhatsApp»");
  const r3 = await pedir(carlos, [{ producto_id: prods[0].id, cajas: 1 }]);
  ok(r3.s === 409, "apagado: la API rechaza el pedido (409)", r3.j.error);

  // ── La caja sigue igual
  const caja = await ver(carlos, "/caja");
  ok(caja.s === 200 && !/Farmagenéricos/.test(caja.t.replace(/by Farmagenéricos Colombia/g, "")), "la caja no cambia");
} finally {
  await q(`update empresas set pedir_farmagenericos = $2 where id = $1`, [E, antes]);
  await pool.end();
}
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
