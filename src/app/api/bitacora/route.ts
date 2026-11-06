import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedeResultados } from "@/lib/gastos";
import { bitacora, filtroBitacora } from "@/lib/bitacora";

/** Bitácora de la droguería (?tipo, usuario, desde, hasta, pagina): 50 eventos por página, más recientes primero, en
 *  español. Solo dueño o administrador. */
export const GET = conSesion(async (s, req) => {
  if (!puedeResultados(s.rol)) return json({ error: "La bitácora la ve el dueño o el administrador" }, 403);
  const f = filtroBitacora(new URL(req.url).searchParams);
  return json({ ...(await comoUsuario(s, (c) => bitacora(c, s.empresa, f))), pagina: f.pagina });
});
