import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { enlaceWhatsAppFarmagenericos, textoPedidoFarmagenericos } from "@/lib/pedido-farmagenericos";

const Pedido = z.object({
  lineas: z.array(z.object({ producto_id: z.string().uuid(), cajas: z.number().int("Las cajas van enteras").min(1).max(10_000) }))
    .min(1, "Elige al menos un producto").max(300, "Máximo 300 productos por pedido"),
});

/** «Pídelo a Farmagenéricos»: guarda el pedido (constancia para la droguería y para el Plan Socio) y devuelve el WhatsApp
 *  de Farmagenéricos con el pedido escrito. Solo dueño, administrador y bodega, y solo si la droguería no apagó el aviso. */
export const POST = conSesion(async (s, req) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega hacen pedidos" }, 403);
  const p = Pedido.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa el pedido" }, 400);
  const pedido = new Map<string, number>();
  for (const l of p.data.lineas) pedido.set(l.producto_id, (pedido.get(l.producto_id) ?? 0) + l.cajas);
  const r = await comoUsuario(s, async (c) => {
    const e = (await c.query(`select coalesce(nombre_comercial, razon_social) drogueria, nit, dv, ciudad, pedir_farmagenericos from empresas where id = $1`, [s.empresa])).rows[0];
    if (!e?.pedir_farmagenericos) return { error: "El pedido a Farmagenéricos está apagado en Equipo › Datos de la droguería", status: 409 };
    // Solo productos de esta droguería (la seguridad por fila ya lo limita; además se comprueba la empresa).
    const prods = (await c.query(`select id, nombre, laboratorio from productos where empresa_id = $1 and id = any($2::uuid[])`, [s.empresa, [...pedido.keys()]])).rows as { id: string; nombre: string; laboratorio: string | null }[];
    if (prods.length !== pedido.size) return { error: "Algún producto no es de tu droguería", status: 400 };
    const orden = [...pedido.keys()];
    const lineas = prods.sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id)).map((x) => ({ producto_id: x.id, nombre: x.nombre, laboratorio: x.laboratorio, cajas: pedido.get(x.id)! }));
    const cajas = lineas.reduce((a, l) => a + l.cajas, 0);
    const id = (await c.query(`insert into pedidos_farmagenericos (empresa_id, usuario_id, lineas, productos, cajas) values ($1, $2, $3, $4, $5) returning id`,
      [s.empresa, s.uid, JSON.stringify(lineas), lineas.length, cajas])).rows[0].id;
    const texto = textoPedidoFarmagenericos({ drogueria: e.drogueria, nit: e.dv ? `${e.nit}-${e.dv}` : e.nit, ciudad: e.ciudad, lineas });
    return { id: String(id), productos: lineas.length, cajas, whatsapp: enlaceWhatsAppFarmagenericos(texto) };
  });
  if ("error" in r) return json({ error: r.error }, r.status);
  return json(r, 201);
});
