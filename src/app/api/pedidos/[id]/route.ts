import { conSesion, esUuid, json } from "@/lib/api";
import { comoUsuario } from "@/lib/db";
import { cajaElegida } from "@/lib/caja-elegida";
import { puedePedidos } from "@/lib/pedidos";
import { CambioEstado, PedidoEntrada, detallePedido, guardarPedido } from "@/lib/pedidos-servidor";

/** Un pedido con sus líneas y los productos al precio y existencias de hoy (para abrirlo en la caja o editarlo). */
export const GET = conSesion(async (s, _req, ctx) => {
  if (!puedePedidos.armar(s.rol)) return json({ error: "Tu usuario no maneja pedidos" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Pedido no encontrado" }, 404);
  const pedido = await comoUsuario(s, (c) => detallePedido(c, s.empresa, id));
  return pedido ? json({ pedido }) : json({ error: "Pedido no encontrado" }, 404);
});

/** Cambia el estado ({estado: en_camino | abierto | cancelado, motivo}) o reemplaza las líneas y los datos del pedido
 *  (mismo cuerpo que al crearlo). Devuelve el pedido actualizado. */
export const PATCH = conSesion(async (s, req, ctx) => {
  if (!puedePedidos.armar(s.rol)) return json({ error: "Tu usuario no maneja pedidos" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Pedido no encontrado" }, 404);
  const cuerpo = await req.json().catch(() => null);
  if (cuerpo && typeof cuerpo === "object" && "estado" in cuerpo) {
    const p = CambioEstado.safeParse(cuerpo);
    if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Estado no válido" }, 400);
    const pedido = await comoUsuario(s, async (c) => {
      if (!(await c.query(`select 1 from pedidos_mostrador where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
      await c.query(`select cambiar_estado_pedido($1, $2, $3)`, [id, p.data.estado, p.data.motivo ?? null]);
      return detallePedido(c, s.empresa, id);
    });
    return pedido ? json({ pedido }) : json({ error: "Pedido no encontrado" }, 404);
  }
  const p = PedidoEntrada.safeParse(cuerpo);
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos del pedido" }, 400);
  const caja = await cajaElegida();
  const pedido = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from pedidos_mostrador where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    return guardarPedido(c, s, p.data, caja, id);
  });
  return pedido ? json({ pedido }) : json({ error: "Pedido no encontrado" }, 404);
});
