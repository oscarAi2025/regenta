// Control especial solo en planes superiores (decisión 19/11/2026): con Esencial, las páginas muestran la invitación a
// Pro, el menú lleva la marca «Pro», las rutas API responden 403 y la impresión del Anexo 13 no se abre; con Pro, todo
// funciona. La venta con fórmula en la caja no depende del plan.
// Uso: servidor en marcha → node tests/e2e/control-plan.mjs
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const E = "10000000-0000-4000-8000-00000000000a", CARLOS = "00000000-0000-4000-8000-000000000001";
const sesion = async () => (await fetch(B + "/api/sesion", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify({ uid: CARLOS }) })).headers.get("set-cookie").split(";")[0];
const ver = async (ck, ruta) => { const r = await fetch(B + ruta, { headers: { cookie: ck, origin: B }, redirect: "manual" }); return { s: r.status, l: r.headers.get("location"), t: (await r.text()).replace(/<!--.*?-->/g, "") }; };
const api = async (ck, ruta, metodo = "GET", body) => { const r = await fetch(B + ruta, { method: metodo, headers: { cookie: ck, origin: B, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const RUTAS = ["/api/control-especial", "/api/control-especial/libro", "/api/control-especial/anexo13", "/api/control-especial/fichas", "/api/control-especial/configuracion"];

const ck = await sesion(); // la entrada de demo funciona solo con la marca demo puesta
const antes = (await q(`select plan, demo from empresas where id = $1`, [E]))[0];
try {
  // ── Esencial (droguería real, sin la marca demo)
  await q(`update empresas set demo = false, plan = 'esencial' where id = $1`, [E]);
  const pg1 = await ver(ck, "/control-especial");
  // Ni en el HTML ni en los datos que viajan con la página (RSC): ningún paciente ni saldo del libro.
  ok(pg1.s === 200 && /Disponible en los planes Pro y Cadena/.test(pg1.t) && !/Saldo por producto|Gloria Inés Martínez|52345678/.test(pg1.t), "Esencial: el libro muestra la invitación a Pro y no envía datos del libro");
  ok(/Pasarme a Pro/.test(pg1.t) && /\/contratar\?plan=pro/.test(pg1.t), "el dueño ve el botón para pasarse a Pro");
  ok(/caja ya pide y guarda la fórmula/.test(pg1.t), "explica que la caja sigue pidiendo la fórmula");
  for (const r of ["/control-especial/anexo-13", "/control-especial/fichas", "/control-especial/libro-completo"]) {
    const x = await ver(ck, r);
    ok(x.s === 200 && /Disponible en los planes Pro y Cadena/.test(x.t) && !/Gloria Inés Martínez|52345678|00000000-01/.test(x.t), `Esencial: ${r} muestra la invitación y no envía datos`);
  }
  ok(/>Pro</.test(pg1.t) && /aria-label="\(plan Pro\)"/.test(pg1.t), "el menú marca «Control especial» con «Pro»");
  const imp = await ver(ck, "/control-especial/anexo-13/imprimir");
  // Next redirige con 307 o, si ya empezó a enviar la página, con la marca NEXT_REDIRECT en la respuesta: las dos valen.
  const redirige = ([302, 303, 307, 308].includes(imp.s) && /\/control-especial$/.test(imp.l ?? "")) || /NEXT_REDIRECT;replace;\/control-especial;/.test(imp.t);
  ok(redirige && !/PRINCIPIO ACTIVO|Recetarios/i.test(imp.t), "Esencial: la impresión del Anexo 13 redirige a la invitación y no trae el informe", `${imp.s} ${imp.l}`);
  for (const r of RUTAS) {
    const a = await api(ck, r);
    ok(a.s === 403 && /planes Pro y Cadena/.test(a.j.error ?? ""), `Esencial: GET ${r} → 403 con mensaje claro`, `${a.s} ${a.j.error ?? ""}`);
  }
  const put = await api(ck, "/api/control-especial/configuracion", "PUT", { departamento: "Tolima" });
  ok(put.s === 403, "Esencial: no se guarda configuración del fondo por la API", String(put.s));
  const post = await api(ck, "/api/control-especial/anexo13", "POST", {});
  ok(post.s === 403, "Esencial: no se registra un informe por la API", String(post.s));

  // ── Pro: el módulo completo
  await q(`update empresas set plan = 'pro' where id = $1`, [E]);
  const pg2 = await ver(ck, "/control-especial");
  ok(pg2.s === 200 && /Libro de control especial/.test(pg2.t) && /Saldo por producto/.test(pg2.t) && !/Disponible en los planes Pro y Cadena/.test(pg2.t), "Pro: el libro se abre");
  ok(!/aria-label="\(plan Pro\)"/.test(pg2.t), "Pro: el menú ya no lleva la marca «Pro»");
  for (const r of RUTAS) { const a = await api(ck, r); ok(a.s === 200, `Pro: GET ${r} → 200`, String(a.s)); }
  const a13 = await ver(ck, "/control-especial/anexo-13");
  ok(a13.s === 200 && /Informe mensual \(Anexo 13\)/.test(a13.t), "Pro: el Anexo 13 se abre");

  // ── Socio y Cadena también
  for (const p of ["socio", "cadena"]) {
    await q(`update empresas set plan = $2 where id = $1`, [E, p]);
    ok((await api(ck, "/api/control-especial/anexo13")).s === 200, `${p}: incluye el módulo`);
  }
} finally {
  await q(`update empresas set plan = $2, demo = $3 where id = $1`, [E, antes.plan, antes.demo]);
}
await pool.end();
console.log(`\n${fallos ? `${fallos} fallos` : "Todo en verde"}`);
process.exit(fallos ? 1 : 0);
