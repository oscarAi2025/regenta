import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { estadoWompi, transaccionWompi } from "@/lib/pagos";
import { eventoWompiValido, type EventoWompi } from "@/lib/pagos-firma";
import { alCambiarPago, cancelarReemplazadas } from "@/lib/pagos-eventos";
import { enviarAhora } from "@/lib/correo";

/** Eventos de Wompi (transaction.updated). El evento solo avisa: con checksum válido se consulta la transacción en la
 *  API de Wompi por su id y lo que manda es esa respuesta (referencia, monto, moneda y estado). Así un evento viejo
 *  reenviado o con la referencia cambiada no puede aprobar ni revivir nada. Responde 200 a todo evento auténtico ya
 *  procesado; si la API de Wompi no responde, 503 para que Wompi lo reintente. */
export async function POST(req: Request) {
  const secreto = process.env.WOMPI_EVENTS_SECRET;
  if (!secreto) return NextResponse.json({ error: "Wompi no configurado" }, { status: 503 });
  const e = (await req.json().catch(() => null)) as EventoWompi | null;
  if (!e || !eventoWompiValido(e, secreto)) return NextResponse.json({ error: "Firma no válida" }, { status: 401 });
  const ev = e.data.transaction as { id?: string } | undefined;
  if (e.event !== "transaction.updated" || !ev?.id || !/^[\w-]{1,80}$/.test(String(ev.id))) return NextResponse.json({ ok: true });
  const t = await transaccionWompi(String(ev.id)).catch(() => null);
  if (!t) return NextResponse.json({ error: "No se pudo confirmar la transacción con Wompi" }, { status: 503 });
  const clave = await sinRLS(async (c) => {
    const o = (await c.query(`select monto, moneda, estado, transaccion from pagos_suscripcion where referencia = $1 and proveedor = 'wompi' for update`, [t.reference])).rows[0];
    if (!o) return null;
    if (o.transaccion && o.transaccion !== t.id && o.estado === "aprobado") {
      // La orden ya la pagó otra transacción: un segundo cobro aprobado (el cliente pagó dos veces) queda a la vista en la
      // consola para devolverlo; no se acredita dos veces.
      if (t.status === "APPROVED") await c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || $2::jsonb, atendido = false where referencia = $1`,
        [t.reference, JSON.stringify({ revisar: "segundo_pago", transaccion_extra: t.id, monto_extra: t.amount_in_cents / 100 })]);
      return null;
    }
    const coincide = t.amount_in_cents === o.monto * 100 && t.currency === o.moneda;
    const estado = coincide ? estadoWompi(t.status ?? "") : "error";
    if (o.estado === "anulado" || o.estado === estado) return null; // anulado es final; sin cambios no se toca nada
    if (o.estado === "aprobado" && estado !== "anulado") return null; // un aprobado solo pasa a anulado
    await c.query(`update pagos_suscripcion set estado = $2, transaccion = $3, metodo = $4, detalle = $5, actualizado = now() where referencia = $1`,
      [t.reference, estado, t.id ?? null, t.payment_method_type ?? null, JSON.stringify(coincide ? { status: t.status } : { status: t.status, error: "monto o moneda no coinciden" })]);
    return o.estado !== estado ? alCambiarPago(c, t.reference!) : null;
  });
  for (const k of clave ?? []) await enviarAhora(k);
  await cancelarReemplazadas();
  return NextResponse.json({ ok: true });
}
