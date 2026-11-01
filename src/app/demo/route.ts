import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { mismoOrigen } from "@/lib/api";
import { crearSesion, demoActiva, leerSesion, USUARIOS_DEMO, type Rol } from "@/lib/sesion";

// «Probar la demo»: un clic (formulario POST desde el propio sitio) entra a la droguería de demostración, sin registro.
// Es POST con verificación de origen para que otro sitio no pueda cambiarle la sesión a nadie, y nunca reemplaza
// la sesión de una droguería real.
const DEMO: Record<string, string> = USUARIOS_DEMO;

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!demoActiva() || !mismoOrigen(req)) return NextResponse.redirect(new URL("/#demo", url), 303);
  const form = await req.formData().catch(() => null);
  const actual = await leerSesion();
  if (actual) {
    const esDemo = await sinRLS(async (c) => (await c.query(`select demo from empresas where id = $1`, [actual.empresa])).rows[0]?.demo);
    if (!esDemo) return NextResponse.redirect(new URL("/inicio", url), 303);
  }
  const uid = DEMO[String(form?.get("rol") ?? "dueno")] ?? DEMO.dueno;
  const m = await sinRLS(async (c) => (await c.query(`select m.empresa_id, m.nombre, m.rol from miembros m join empresas e on e.id = m.empresa_id where m.user_id = $1 and m.activo and e.demo limit 1`, [uid])).rows[0]);
  if (!m) return NextResponse.redirect(new URL("/entrar", url), 303);
  await crearSesion({ uid, empresa: m.empresa_id, nombre: m.nombre, rol: m.rol as Rol });
  return NextResponse.redirect(new URL(m.rol === "cajero" ? "/caja" : "/inicio", url), 303);
}

/** Enlaces antiguos a /demo: página mínima con el botón (un GET nunca crea sesión). */
export async function GET() {
  const html = `<!doctype html><html lang="es-CO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Probar Regenta</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#102a43;color:#fff;font-family:system-ui,sans-serif}form{text-align:center;padding:24px}h1{font-size:28px}button{font:600 18px system-ui;background:#0b7a55;color:#fff;border:0;border-radius:12px;padding:16px 28px;cursor:pointer}</style></head>
<body><form method="post" action="/demo"><h1>Entra a la droguería de demostración</h1><p>Sin registro y sin tarjeta.</p><button autofocus>Probar la demo ahora</button></form></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
