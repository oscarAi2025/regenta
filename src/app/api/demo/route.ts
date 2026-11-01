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
  web: z.string().max(0).optional(), // trampa para bots: debe llegar vacío
});

/** Solicitud de demostración desde la página comercial. */
export async function POST(req: Request) {
  const p = Solicitud.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  const d = p.data;
  await sinRLS((c) => c.query(
    `insert into solicitudes_demo (nombre, drogueria, ciudad, telefono, email, cajas, mensaje, origen) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [d.nombre, d.drogueria, d.ciudad || null, d.telefono, d.email || null, d.cajas || null, d.mensaje || null, d.origen || null]));
  return NextResponse.json({ ok: true }, { status: 201 });
}
