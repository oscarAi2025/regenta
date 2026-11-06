import { conSesion, json } from "@/lib/api";
import { comoUsuario } from "@/lib/db";
import { cajaElegida } from "@/lib/caja-elegida";
import { puedePedidos } from "@/lib/pedidos";
import { PedidoEntrada, enDomicilios, guardarPedido, leerFiltroPedidos, listarPedidos } from "@/lib/pedidos-servidor";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lista de pedidos (filtros tipo, estado, q) o, con ?en_domicilio=id,id, las unidades de esos productos que van en
 *  domicilios abiertos (aviso de la caja; ?excluir=pedido para no contar el que está en la caja). */
export const GET = conSesion(async (s, req) => {
  if (!puedePedidos.armar(s.rol)) return json({ error: "Tu usuario no maneja pedidos" }, 403);
  const sp = new URL(req.url).searchParams;
  if (sp.has("en_domicilio")) {
    const ids = (sp.get("en_domicilio") ?? "").split(",").filter((x) => uuid.test(x)).slice(0, 200);
    const excluir = sp.get("excluir");
    const r = await comoUsuario(s, (c) => enDomicilios(c, s.empresa, ids, excluir && uuid.test(excluir) ? excluir : null));
    return json({ productos: r });
  }
  const f = leerFiltroPedidos(Object.fromEntries(sp));
  const pedidos = await comoUsuario(s, (c) => listarPedidos(c, s.empresa, f, 100));
  return json({ pedidos });
});

/** Crea un pedido (espera, domicilio o cotización) con la caja de este equipo. Devuelve el pedido completo. */
export const POST = conSesion(async (s, req) => {
  if (!puedePedidos.armar(s.rol)) return json({ error: "Tu usuario no maneja pedidos" }, 403); // el permiso se mira antes que los datos
  const p = PedidoEntrada.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos del pedido" }, 400);
  const caja = await cajaElegida();
  const pedido = await comoUsuario(s, (c) => guardarPedido(c, s, p.data, caja));
  return json({ pedido }, 201);
});
