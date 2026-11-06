import { puede } from "@/lib/sesion";
import { cajaElegida } from "@/lib/caja-elegida";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { Venta, emitirDocumento, errorVenta, registrarVenta } from "@/lib/venta-servidor";

/** Registra la venta (la base de datos fija precios, lotes, numeración y reglas de crédito) y emite su documento DIAN.
 *  La misma lógica cobra los pedidos del mostrador (src/lib/venta-servidor.ts). */
export const POST = conSesion(async (s, req) => {
  if (!puede.vender(s.rol)) return json({ error: "Tu usuario no puede vender" }, 403); // el permiso se mira antes que los datos
  const p = Venta.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: errorVenta(p.error) }, 400);
  const caja = await cajaElegida();
  const r = await comoUsuario(s, (c) => registrarVenta(c, s, p.data, caja));
  if ("invalida" in r) return json({ error: r.invalida }, 400);
  return json({ venta: r.venta, documento: await emitirDocumento(s, r.venta.venta_id) });
});
