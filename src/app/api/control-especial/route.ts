import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { csv, rango } from "@/lib/reportes";
import { COLUMNAS_LIBRO, COLUMNAS_SALDOS, datosLibro, filaCsv } from "@/lib/libro-control";

/** Libro de control especial (JSON o CSV para Excel). Solo dueño y administrador: lleva datos de pacientes. */
export const GET = conSesion(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "El libro de control especial lo ven el dueño o el administrador" }, 403);
  const u = new URL(req.url).searchParams;
  const r = rango(u.get("desde"), u.get("hasta"));
  const producto = u.get("producto");
  if (producto && !esUuid(producto)) return json({ error: "Producto no válido" }, 400);
  const tipo = u.get("tipo") ?? "libro";
  if (!["libro", "saldos"].includes(tipo)) return json({ error: "Reporte no válido" }, 400);
  const d = await comoUsuario(s, (c) => datosLibro(c, s.empresa, r, producto));
  if (u.get("formato") !== "csv") return json({ ...r, ...d });
  const cuerpo = tipo === "saldos" ? csv(d.saldos, COLUMNAS_SALDOS) : csv(d.filas.map(filaCsv), COLUMNAS_LIBRO);
  return new Response(cuerpo, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
    "content-disposition": `attachment; filename="regenta-control-especial-${tipo}-${r.desde}-a-${r.hasta}.csv"` } });
});

const Config = z.object({ vigencia_dias: z.number().int().min(1, "La vigencia va de 1 a 365 días").max(365, "La vigencia va de 1 a 365 días"), exige_datos: z.boolean() });

/** Configuración de la droguería: días de vigencia de la fórmula de control especial y si los productos «con fórmula»
 *  también piden registrar los datos. Dueño y administrador. */
export const PATCH = conSesion(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador cambian esta configuración" }, 403);
  const p = Config.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, 400);
  await comoUsuario(s, (c) => c.query(`select configurar_formulas($1, $2, $3)`, [s.empresa, p.data.vigencia_dias, p.data.exige_datos]));
  return json({ ok: true });
});
