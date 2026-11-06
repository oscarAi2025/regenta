import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedeResultados } from "@/lib/gastos";
import { cierreDia, fechaValida, hoyBogota } from "@/lib/reportes";

/** Cierre del día consolidado (todas las cajas y turnos del día). ?fecha=AAAA-MM-DD, por defecto hoy. Dueño o administrador. */
export const GET = conSesion(async (s, req) => {
  if (!puedeResultados(s.rol)) return json({ error: "El cierre del día lo ve el dueño o el administrador" }, 403);
  const f = new URL(req.url).searchParams.get("fecha");
  const hoy = hoyBogota();
  const dia = fechaValida(f) && f! <= hoy ? f! : hoy;
  return json(await comoUsuario(s, (c) => cierreDia(c, s.empresa, dia)));
});
