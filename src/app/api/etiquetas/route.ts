import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puedePrecios } from "@/lib/precios";
import { productosEtiquetas } from "@/lib/etiquetas-datos";

/** Datos para etiquetas de góndola: ?ids=a,b,c o ?compra=N (lo recibido en esa compra). Dueño, administrador o bodega. */
export const GET = conSesion(async (s, req) => {
  if (!puedePrecios.etiquetas(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega imprimen etiquetas" }, 403);
  const sp = new URL(req.url).searchParams;
  const compra = sp.get("compra");
  if (compra !== null && !/^\d{1,9}$/.test(compra)) return json({ error: "Número de compra no válido" }, 400);
  const ids = (sp.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.some((x) => !esUuid(x))) return json({ error: "Hay un producto no válido" }, 400);
  const r = await comoUsuario(s, (c) => productosEtiquetas(c, s.empresa, compra !== null ? { compra: Number(compra) } : { ids }));
  return r ? json(r) : json({ error: `No hay una compra N.º ${compra} en tu droguería` }, 404);
});
