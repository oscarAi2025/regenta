import { NextResponse } from "next/server";
import { z } from "zod";
import { sinRLS } from "@/lib/db";

const Solicitud = z.object({
  nombre: z.string().trim().min(2, "Escribe tu nombre").max(120),
  drogueria: z.string().trim().min(2, "Escribe el nombre de la droguería").max(160),
  ciudad: z.string().trim().max(80).nullish(),
  telefono: z.string().trim().regex(/^[\d\s+()-]{7,20}$/, "Escribe un celular válido"),
  email: z.string().trim().email("Correo no válido").max(160).nullish().or(z.literal("")),
  cajas: z.string().trim().max(20).nullish(),
  mensaje: z.string().trim().max(1000).nullish(),
  origen: z.string().trim().max(200).nullish(),
  web: z.string().optional(),
});

/** Solicitud de demostración desde la página comercial. */
// Límite por IP: 5 solicitudes cada 10 minutos (por instancia del servidor).
const envios = new Map<string, number[]>();
const permitido = (ip: string) => {
  const ahora = Date.now(), v = (envios.get(ip) ?? []).filter((t) => ahora - t < 600000);
  if (v.length >= 5) return false;
  v.push(ahora); envios.set(ip, v); return true;
};

export async function POST(req: Request) {
  const cuerpo = await req.json().catch(() => null);
  // Trampa para bots: si el campo oculto viene lleno, se responde como si todo saliera bien y no se guarda nada.
  if (cuerpo && typeof cuerpo.web === "string" && cuerpo.web.length > 0) return NextResponse.json({ ok: true }, { status: 201 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (!permitido(ip)) return NextResponse.json({ error: "Ya recibimos tus datos. Si quieres, escríbenos por WhatsApp." }, { status: 429 });
  const p = Solicitud.safeParse(cuerpo);
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  const d = p.data;
  await sinRLS((c) => c.query(
    `insert into solicitudes_demo (nombre, drogueria, ciudad, telefono, email, cajas, mensaje, origen) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [d.nombre, d.drogueria, d.ciudad || null, d.telefono, d.email || null, d.cajas || null, d.mensaje || null, d.origen || null]));
  return NextResponse.json({ ok: true }, { status: 201 });
}
