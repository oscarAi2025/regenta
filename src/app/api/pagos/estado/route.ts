import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { estadoWompi, transaccionWompi, wompiActivo } from "@/lib/pagos";
import { alCambiarPago } from "@/lib/pagos-eventos";
import { enviarAhora } from "@/lib/correo";

/** Estado de una orden por su referencia (solo estado y plan: nada personal). Al volver de Wompi con ?id= se confirma
 *  contra la API de Wompi por si el evento aún no llegó. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const ref = (sp.get("ref") ?? "").slice(0, 80), id = (sp.get("id") ?? "").slice(0, 80);
  if (!/^RG-[A-Z]+-[0-9A-Z]+-[0-9A-F]{8}$/.test(ref)) return NextResponse.json({ error: "Referencia no válida" }, { status: 400 });
  let o = (await sinRLS((c) => c.query(`select estado, plan, periodo, monto, proveedor from pagos_suscripcion where referencia = $1`, [ref]))).rows[0];
  if (!o) return NextResponse.json({ error: "No encontramos ese pago" }, { status: 404 });
  if (o.estado === "pendiente" && o.proveedor === "wompi" && id && wompiActivo()) {
    const t = await transaccionWompi(id).catch(() => null);
    if (t && t.reference === ref && t.amount_in_cents === o.monto * 100 && t.currency === "COP") {
      const estado = estadoWompi(t.status);
      const clave = await sinRLS(async (c) => {
        const n = await c.query(`update pagos_suscripcion set estado = $2, transaccion = $3, metodo = $4, actualizado = now() where referencia = $1 and estado = 'pendiente'`, [ref, estado, t.id, t.payment_method_type ?? null]);
        return n.rowCount && estado !== "pendiente" ? alCambiarPago(c, ref) : null;
      });
      if (clave) await enviarAhora(clave);
      o = { ...o, estado };
    }
  }
  return NextResponse.json({ estado: o.estado, plan: o.plan, periodo: o.periodo, monto: o.monto });
}
