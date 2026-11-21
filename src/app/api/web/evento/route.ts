import { z } from "zod";
import { cookies } from "next/headers";
import { sinRLS } from "@/lib/db";
import { ipCliente, json, limitador, mismoOrigen } from "@/lib/api";
import { dispositivo, leerOrigen } from "@/lib/visitas-demo-core";
import { COOKIE_ORIGEN } from "@/lib/visitas-demo";
import { COOKIE_INTERNO } from "@/lib/interno";

/** Embudo de la web pública (059): vistas de página y clics a «Probar», «Contratar», WhatsApp y el formulario.
 *  Público y sin sesión: solo desde el propio sitio, con tope por conexión, y nunca falla para el visitante. */
const Evento = z.object({
  v: z.string().regex(/^[a-z0-9]{8,32}$/).nullish(),
  tipo: z.enum(["vista", "demo", "contratar", "whatsapp", "formulario"]),
  ruta: z.string().max(160).regex(/^\//),
  detalle: z.string().max(120).nullish(),
});
const permitido = limitador(60, 60_000);

export async function POST(req: Request) {
  if (!mismoOrigen(req)) return json({ ok: false }, 403);
  const p = Evento.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ ok: false }, 400);
  if (!permitido(ipCliente(req))) return json({ ok: true });
  try {
    const jar = await cookies();
    if (jar.get(COOKIE_INTERNO)?.value === "1") return json({ ok: true }); // el equipo no cuenta en el embudo
    const o = leerOrigen(jar.get(COOKIE_ORIGEN)?.value);
    const d = dispositivo(req.headers.get("user-agent") ?? "").dispositivo;
    const limpio = (s: string | null | undefined, n: number) => (s ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n) || null;
    await sinRLS((c) => c.query(`insert into web_eventos (visitante, tipo, ruta, detalle, origen, dispositivo) values ($1, $2, $3, $4, $5, $6)`,
      [p.data.v ?? null, p.data.tipo, limpio(p.data.ruta.split("?")[0], 160), limpio(p.data.detalle, 120), o.origen ?? "directo", d]));
  } catch (e) { console.error("web evento", (e as Error).message); }
  return json({ ok: true });
}
