import { NextResponse } from "next/server";
import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { ipCliente, limitador, mismoOrigen } from "@/lib/api";
import { datosQr, enlaceWompi, nuevaReferencia, precio, qrActivo, sesionStripe, stripeActivo, wompiActivo } from "@/lib/pagos";
import { encolar, enviarAhora } from "@/lib/correo";
import { SITIO } from "@/lib/sitio";

const Contratar = z.object({
  plan: z.enum(["esencial", "pro"]), periodo: z.enum(["mes", "anio"]), proveedor: z.enum(["qr", "wompi", "stripe"]),
  nombre: z.string().trim().min(3, "Escribe tu nombre").max(120),
  empresa: z.string().trim().min(2, "Escribe el nombre de la droguería o empresa").max(160),
  nit: z.string().trim().regex(/^[\d.\s-]{6,15}$/, "Escribe el NIT de la droguería (o tu cédula) sin letras"),
  email: z.string().trim().email("Escribe un correo válido: ahí te llega el acceso").max(160),
  telefono: z.string().trim().regex(/^[\d\s+()-]{7,20}$/, "Escribe un celular válido"),
  acepta: z.literal(true, { errorMap: () => ({ message: "Marca la autorización de tratamiento de datos para continuar" }) }),
});

const permitido = limitador(8, 600000);

/** Inicia el pago de un plan: guarda la orden pendiente y devuelve el enlace de la pasarela. */
export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!permitido(ipCliente(req))) return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos o escríbenos por WhatsApp." }, { status: 429 });
  const p = Contratar.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  const d = p.data;
  if (!(d.proveedor === "qr" ? qrActivo() : d.proveedor === "wompi" ? wompiActivo() : stripeActivo())) return NextResponse.json({ error: "Ese medio de pago aún no está activo. Escríbenos por WhatsApp y te ayudamos." }, { status: 503 });
  const referencia = nuevaReferencia(d.plan), monto = precio(d.plan, d.periodo);
  await sinRLS((c) => c.query(
    `insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, nit, email, telefono) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [referencia, d.plan, d.periodo, monto, d.proveedor, d.nombre, d.empresa, d.nit || null, d.email, d.telefono]));
  if (d.proveedor === "qr") {
    // Sin pasarela: la orden queda pendiente con las instrucciones (también por correo) hasta que se confirme en la consola.
    const q = datosQr(), clave = `pago:${referencia}:qr`;
    await sinRLS((c) => encolar(c, { clave, para: d.email, plantilla: "pago_qr", datos: { nombre: d.nombre, plan: d.plan === "pro" ? "Pro" : "Esencial", periodo: d.periodo, monto, referencia, llave: q.llave, titular: q.titular, enlace: `${SITIO}/contratar/resultado?ref=${referencia}` } }));
    await enviarAhora(clave);
    return NextResponse.json({ url: `/contratar/resultado?ref=${encodeURIComponent(referencia)}`, referencia }, { status: 201 });
  }
  try {
    if (d.proveedor === "wompi") return NextResponse.json({ url: enlaceWompi({ referencia, monto, email: d.email, nombre: d.nombre, telefono: d.telefono, nit: d.nit }), referencia }, { status: 201 });
    const s = await sesionStripe({ referencia, plan: d.plan, periodo: d.periodo, monto, email: d.email });
    await sinRLS((c) => c.query(`update pagos_suscripcion set transaccion = $2, actualizado = now() where referencia = $1`, [referencia, s.id]));
    return NextResponse.json({ url: s.url, referencia }, { status: 201 });
  } catch (e) {
    console.error("pagos", e);
    await sinRLS((c) => c.query(`update pagos_suscripcion set estado = 'error', detalle = $2, actualizado = now() where referencia = $1`, [referencia, JSON.stringify({ error: String((e as Error).message) })]));
    return NextResponse.json({ error: "La pasarela no respondió. Intenta de nuevo o escríbenos por WhatsApp." }, { status: 502 });
  }
}
