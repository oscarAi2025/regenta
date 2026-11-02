import { NextResponse } from "next/server";
import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { ipCliente, limitador, mismoOrigen } from "@/lib/api";
import { encolarEmbudo, enviarAhora } from "@/lib/correo";
import { TEXTO_CORREOS } from "@/lib/sitio";

const Solicitud = z.object({
  nombre: z.string().trim().min(2, "Escribe tu nombre").max(120),
  drogueria: z.string().trim().min(2, "Escribe el nombre de la droguería").max(160),
  ciudad: z.string().trim().max(80).nullish(),
  telefono: z.string().trim().regex(/^[\d\s+()-]{7,20}$/, "Escribe un celular válido"),
  email: z.string().trim().email("Correo no válido").max(160).nullish().or(z.literal("")),
  cajas: z.string().trim().max(20).nullish(),
  mensaje: z.string().trim().max(1000).nullish(),
  origen: z.string().trim().max(200).nullish(),
  acepta: z.union([z.boolean(), z.literal("on"), z.literal("")]).nullish(),
  web: z.string().optional(),
});

/** Solicitud de demostración desde la página comercial. */
// Límite por IP: 5 solicitudes válidas cada 10 minutos (por instancia del servidor).
const permitido = limitador(5, 600000);

export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const cuerpo = await req.json().catch(() => null);
  // Trampa para bots: si el campo oculto viene lleno, se responde como si todo saliera bien y no se guarda nada.
  if (cuerpo && typeof cuerpo.web === "string" && cuerpo.web.length > 0) return NextResponse.json({ ok: true }, { status: 201 });
  const p = Solicitud.safeParse(cuerpo);
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  // Solo cuentan las solicitudes válidas: corregir un dato mal escrito no gasta el límite.
  if (!permitido(ipCliente(req))) return NextResponse.json({ error: "Ya recibimos tus datos. Si quieres, escríbenos por WhatsApp." }, { status: 429 });
  const d = p.data;
  const acepta = !!d.email && (d.acepta === true || d.acepta === "on");
  const consentimiento = acepta ? { texto: TEXTO_CORREOS, fecha: new Date().toISOString(), ip: ipCliente(req), navegador: (req.headers.get("user-agent") ?? "").slice(0, 200), origen: d.origen ?? null } : null;
  const id = await sinRLS(async (c) => {
    const id = Number((await c.query(
      `insert into solicitudes_demo (nombre, drogueria, ciudad, telefono, email, cajas, mensaje, origen, acepta_correos, consentimiento) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [d.nombre, d.drogueria, d.ciudad || null, d.telefono, d.email || null, d.cajas || null, d.mensaje || null, d.origen || null, acepta, consentimiento ? JSON.stringify(consentimiento) : null])).rows[0].id);
    if (d.email) await encolarEmbudo(c, { id, email: d.email, nombre: d.nombre, drogueria: d.drogueria, acepta });
    return id;
  });
  if (d.email) await enviarAhora(`solicitud:${id}`);
  return NextResponse.json({ ok: true }, { status: 201 });
}
