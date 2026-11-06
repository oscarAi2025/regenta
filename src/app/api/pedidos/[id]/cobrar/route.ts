import { conSesion, esUuid, json } from "@/lib/api";
import { comoUsuario } from "@/lib/db";
import { cajaElegida } from "@/lib/caja-elegida";
import { puedePedidos } from "@/lib/pedidos";
import { Venta, emitirDocumento, errorVenta, registrarVenta } from "@/lib/venta-servidor";

/** Cobra un pedido: registra la venta con la misma lógica que POST /api/ventas (src/lib/venta-servidor.ts) (al precio vigente) y, en la MISMA
 *  transacción, marca el pedido cobrado y lo enlaza (cobrar_pedido bloquea la fila: dos cajas no lo cobran dos veces). */
export const POST = conSesion(async (s, req, ctx) => {
  if (!puedePedidos.cobrar(s.rol)) return json({ error: "Tu usuario no puede cobrar: pásale el pedido a la caja" }, 403); // el permiso se mira antes que los datos
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Pedido no encontrado" }, 404);
  const p = Venta.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: errorVenta(p.error) }, 400);
  if (p.data.sin_conexion) return json({ error: "Un pedido guardado se cobra con conexión" }, 400);
  const caja = await cajaElegida();
  const r = await comoUsuario(s, async (c) => {
    // Antes de tocar la numeración: el pedido existe, es de esta droguería y se puede cobrar (o es el reintento de su
    // misma venta). La comprobación definitiva, con bloqueo, la hace cobrar_pedido.
    const ped = (await c.query(`select pm.estado, v.idem_key from pedidos_mostrador pm left join ventas v on v.id = pm.venta_id
      where pm.id = $1 and pm.empresa_id = $2`, [id, s.empresa])).rows[0] as { estado: string; idem_key: string | null } | undefined;
    if (!ped) return { status: 404, error: "Pedido no encontrado" };
    if (ped.estado === "cancelado") return { status: 422, error: "Este pedido está cancelado: no se puede cobrar" };
    if (ped.estado === "cobrado" && ped.idem_key !== p.data.idem_key) return { status: 409, error: "Este pedido ya se cobró en otra venta" };
    const v = await registrarVenta(c, s, p.data, caja);
    if ("invalida" in v) return { status: 400, error: v.invalida };
    await c.query(`select cobrar_pedido($1, $2)`, [id, v.venta.venta_id]);
    return { venta: v.venta };
  });
  if ("error" in r) return json({ error: r.error }, r.status);
  return json({ venta: r.venta, documento: await emitirDocumento(s, r.venta.venta_id), pedido: { id, estado: "cobrado" } });
});
