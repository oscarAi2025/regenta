import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { ipCliente, limiteBD, mismoOrigen } from "@/lib/api";
import { crearSesion, demoActiva, leerSesion, USUARIOS_DEMO, type Rol } from "@/lib/sesion";
import { crearVisita } from "@/lib/visitas-demo";

// «Probar la demo»: un clic (formulario POST desde el propio sitio) entra a la droguería de demostración, sin registro.
// Es POST con verificación de origen para que otro sitio no pueda cambiarle la sesión a nadie, y nunca reemplaza
// la sesión de una droguería real.
const DEMO: Record<string, string> = USUARIOS_DEMO;

// Redirección relativa: en Netlify req.url trae el host interno del despliegue (main--sitio.netlify.app), y una
// redirección absoluta con él mandaba al visitante a otro dominio, sin la cookie de sesión recién creada.
const ir = (ruta: string) => new NextResponse(null, { status: 303, headers: { Location: ruta } });

export async function POST(req: Request) {
  if (!demoActiva() || !mismoOrigen(req)) return ir("/#demo");
  // Tope de entradas por conexión: la demo es pública y cada entrada crea una sesión y una visita.
  if (!(await limiteBD(`demo:entrar:${ipCliente(req)}`, 40, "1 hour"))) return ir("/#demo");
  const form = await req.formData().catch(() => null);
  const actual = await leerSesion();
  if (actual) {
    const esDemo = await sinRLS(async (c) => (await c.query(`select demo from empresas where id = $1`, [actual.empresa])).rows[0]?.demo);
    if (!esDemo) return ir("/inicio");
  }
  const uid = DEMO[String(form?.get("rol") ?? "dueno")] ?? DEMO.dueno;
  const m = await sinRLS(async (c) => (await c.query(`select m.empresa_id, m.nombre, m.rol from miembros m join empresas e on e.id = m.empresa_id where m.user_id = $1 and m.activo and e.demo limit 1`, [uid])).rows[0]);
  if (!m) return ir("/entrar");
  await crearSesion({ uid, empresa: m.empresa_id, nombre: m.nombre, rol: m.rol as Rol });
  // Consola → Visitas a la demo: de dónde viene, ciudad, dispositivo y qué hace dentro (nunca bloquea la entrada).
  await crearVisita(req, String(form?.get("rol") ?? "dueno"));
  return ir(m.rol === "cajero" ? "/caja" : "/inicio");
}

/** Enlaces antiguos a /demo: página mínima con el botón (un GET nunca crea sesión). */
export async function GET() {
  const html = `<!doctype html><html lang="es-CO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Probar Regenta</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#102a43;color:#fff;font-family:system-ui,sans-serif}form{text-align:center;padding:24px}h1{font-size:28px}button{font:600 18px system-ui;background:#0b7a55;color:#fff;border:0;border-radius:12px;padding:16px 28px;cursor:pointer}</style></head>
<body><form method="post" action="/demo"><h1>Entra a la droguería de demostración</h1><p>Sin registro y sin tarjeta.</p><button autofocus>Probar la demo ahora</button></form></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
