import { z } from "zod";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { cajaElegida } from "@/lib/caja-elegida";
import { MEDIO_IDS, nombreMedio } from "@/lib/compras";
import { CATEGORIA_IDS, nombreCategoria, puedeResultados } from "@/lib/gastos";
import { filtroGastos, listaGastos } from "@/lib/gastos-datos";
import { excel, hoyBogota, pideExcel, respuestaExcel } from "@/lib/reportes";
import { fechaReal } from "@/lib/validar";

const Gasto = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida").refine(fechaReal, "Fecha no válida"),
  categoria: z.enum(CATEGORIA_IDS, { errorMap: () => ({ message: "Elige la categoría del gasto" }) }),
  descripcion: z.string().trim().min(3, "Escribe en qué se gastó").max(200, "La descripción admite máximo 200 caracteres"),
  medio: z.enum(MEDIO_IDS, { errorMap: () => ({ message: "Elige el medio de pago" }) }),
  valor: z.number().positive("Escribe el valor del gasto").max(10_000_000_000, "Revisa el valor del gasto").refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Máximo dos decimales"),
  referencia: z.string().trim().max(60, "La referencia admite máximo 60 caracteres").nullish(),
  desde_caja: z.boolean().default(true),
  idem_key: z.string().max(80).nullish(),
});
const Anular = z.object({ id: z.string().uuid("Gasto no válido"), motivo: z.string().trim().min(4, "Escribe el motivo de la anulación").max(300, "El motivo admite máximo 300 caracteres") });
const NEGADO = "Los gastos los maneja el dueño o el administrador";

/** Gastos con filtros (?desde, hasta, categoria, estado, q). JSON o Excel (?formato=excel). Solo dueño o administrador. */
export const GET = conSesion(async (s, req) => {
  if (!puedeResultados(s.rol)) return json({ error: NEGADO }, 403);
  const sp = new URL(req.url).searchParams;
  const f = filtroGastos(sp);
  const gastos = await comoUsuario(s, (c) => listaGastos(c, s.empresa, f));
  if (pideExcel(sp.get("formato"))) {
    const filas = gastos.map((g) => ({ ...g, numero: `G-${g.numero}`, categoria: nombreCategoria(g.categoria), medio: nombreMedio(g.medio), estado: g.anulado ? "Anulado" : "Vigente",
      usuario: String(g.usuario ?? "").split(" (")[0] }));
    return respuestaExcel(excel("Gastos", filas, [["numero", "Gasto"], ["fecha", "Fecha"], ["categoria", "Categoría"], ["descripcion", "Descripción"], ["medio", "Medio"], ["referencia", "Referencia"],
      ["caja", "Salió de la caja"], ["valor", "Valor"], ["estado", "Estado"], ["motivo", "Motivo de anulación"], ["usuario", "Registró"], ["creado", "Registrado"]]),
      `regenta-gastos-${f.desde || "inicio"}-a-${f.hasta || hoyBogota()}.xlsx`);
  }
  return json({ gastos });
});

/** Registrar un gasto. En efectivo desde la caja exige el turno abierto de la caja de este equipo y sale como egreso del
 *  turno en la misma transacción. Devuelve el gasto y la lista actualizada con los filtros de la dirección (?desde…). */
export const POST = conSesion(async (s, req) => {
  if (!puedeResultados(s.rol)) return json({ error: "Solo el dueño o el administrador registran gastos" }, 403); // el permiso se mira antes que los datos
  const p = Gasto.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos del gasto incompletos" }, 400);
  const caja = await cajaElegida();
  const r = await comoUsuario(s, async (c) => {
    const puesto = await puestoDeTrabajo(c, s.empresa, caja);
    const k = (await c.query(`select registrar_gasto($1) r`, [{ ...p.data, empresa_id: s.empresa, sede_id: puesto.sede_id, caja_id: puesto.caja_id }])).rows[0].r;
    return { ...k, gastos: await listaGastos(c, s.empresa, filtroGastos(new URL(req.url).searchParams)) };
  });
  return json(r, r.repetido ? 200 : 201);
});

/** Anular un gasto con motivo (si salió de la caja, el efectivo vuelve al turno abierto de esa caja). */
export const DELETE = conSesion(async (s, req) => {
  if (!puedeResultados(s.rol)) return json({ error: "Solo el dueño o el administrador anulan gastos" }, 403);
  const p = Anular.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Escribe el motivo" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from gastos where id = $1 and empresa_id = $2`, [p.data.id, s.empresa])).rowCount) return null;
    const k = (await c.query(`select anular_gasto($1, $2) r`, [p.data.id, p.data.motivo])).rows[0].r;
    return { ...k, gastos: await listaGastos(c, s.empresa, filtroGastos(new URL(req.url).searchParams)) };
  });
  return r ? json(r) : json({ error: "Ese gasto no existe en tu droguería" }, 404);
});
