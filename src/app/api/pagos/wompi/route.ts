import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { estadoWompi } from "@/lib/pagos";
import { eventoWompiValido, type EventoWompi } from "@/lib/pagos-firma";

/** Eventos de Wompi (transaction.updated). Se aceptan solo con checksum válido y si el monto y la moneda coinciden con
 *  la orden. Responde 200 a todo evento auténtico para que Wompi no reintente. */
export async function POST(req: Request) {
  const secreto = process.env.WOMPI_EVENTS_SECRET;
  if (!secreto) return NextResponse.json({ error: "Wompi no configurado" }, { status: 503 });
  const e = (await req.json().catch(() => null)) as EventoWompi | null;
  if (!e || !eventoWompiValido(e, secreto)) return NextResponse.json({ error: "Firma no válida" }, { status: 401 });
  const t = e.data.transaction as { id?: string; reference?: string; status?: string; amount_in_cents?: number; currency?: string; payment_method_type?: string } | undefined;
  if (e.event !== "transaction.updated" || !t?.reference) return NextResponse.json({ ok: true });
  await sinRLS(async (c) => {
    const o = (await c.query(`select monto, moneda, estado from pagos_suscripcion where referencia = $1 and proveedor = 'wompi' for update`, [t.reference])).rows[0];
    if (!o) return;
    const coincide = t.amount_in_cents === o.monto * 100 && t.currency === o.moneda;
    const estado = coincide ? estadoWompi(t.status ?? "") : "error";
    if (o.estado === "aprobado" && estado !== "anulado") return; // un aprobado no retrocede por un evento viejo
    await c.query(`update pagos_suscripcion set estado = $2, transaccion = $3, metodo = $4, detalle = $5, actualizado = now() where referencia = $1`,
      [t.reference, estado, t.id ?? null, t.payment_method_type ?? null, JSON.stringify(coincide ? { status: t.status } : { status: t.status, error: "monto o moneda no coinciden" })]);
  });
  return NextResponse.json({ ok: true });
}
