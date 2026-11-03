import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { datosQr, estadoWompi, transaccionWompi, wompiActivo } from "@/lib/pagos";
import { alCambiarPago, cancelarReemplazadas } from "@/lib/pagos-eventos";
import { enviarAhora } from "@/lib/correo";
import { ipCliente, limitador } from "@/lib/api";

const permitido = limitador(60, 60000); // la página de resultado consulta cada pocos segundos; nadie necesita más

/** Estado de una orden por su referencia (solo estado y plan: nada personal). Al volver de Wompi con ?id= se confirma
 *  contra la API de Wompi por si el evento aún no llegó. */
export async function GET(req: Request) {
  if (!permitido(ipCliente(req))) return NextResponse.json({ error: "Demasiadas consultas: espera un minuto" }, { status: 429 });
  const sp = new URL(req.url).searchParams;
  const ref = (sp.get("ref") ?? "").slice(0, 80), id = (sp.get("id") ?? "").slice(0, 80);
  if (!/^RG-[A-Z]+-[0-9A-Z]+-[0-9A-F]{8}$/.test(ref)) return NextResponse.json({ error: "Referencia no válida" }, { status: 400 });
  let o = (await sinRLS((c) => c.query(`select estado, plan, periodo, monto, proveedor, email, empresa_id from pagos_suscripcion where referencia = $1`, [ref]))).rows[0];
  if (!o) return NextResponse.json({ error: "No encontramos ese pago" }, { status: 404 });
  if (o.estado === "pendiente" && o.proveedor === "wompi" && id && wompiActivo()) {
    const t = await transaccionWompi(id).catch(() => null);
    if (t && t.reference === ref && t.amount_in_cents === o.monto * 100 && t.currency === "COP") {
      const estado = estadoWompi(t.status);
      const clave = await sinRLS(async (c) => {
        const n = await c.query(`update pagos_suscripcion set estado = $2, transaccion = $3, metodo = $4, actualizado = now() where referencia = $1 and estado = 'pendiente'`, [ref, estado, t.id, t.payment_method_type ?? null]);
        return n.rowCount && estado !== "pendiente" ? alCambiarPago(c, ref) : null;
      });
      for (const k of clave ?? []) await enviarAhora(k);
      await cancelarReemplazadas();
      o = { ...o, estado, empresa_id: (await sinRLS((c) => c.query(`select empresa_id from pagos_suscripcion where referencia = $1`, [ref]))).rows[0]?.empresa_id };
    }
  }
  // Para el QR se devuelven los datos públicos de la cuenta (llave y titular) para mostrarlos junto al monto.
  // Con la cuenta creada se dice a qué correo llegó el acceso, enmascarado (la referencia no debe revelar datos personales).
  const oculto = (m: string) => m.replace(/^(.{2})[^@]*(@.).*(\..+)$/, "$1•••$2•••$3");
  return NextResponse.json({ estado: o.estado, plan: o.plan, periodo: o.periodo, monto: o.monto, proveedor: o.proveedor, cuenta: !!o.empresa_id, ...(o.empresa_id ? { correo: oculto(String(o.email)) } : {}), ...(o.proveedor === "qr" ? { qr: datosQr() } : {}) });
}
