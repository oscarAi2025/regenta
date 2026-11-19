import { conControlEspecial } from "@/lib/control-plan";
import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { hojaDeFilas, hoyBogota, respuestaExcel } from "@/lib/reportes";
import { libroXlsx } from "@/lib/xlsx";
import { detiene, mesAnterior, mesValido } from "@/lib/anexo13";
import { COLUMNAS_RECETARIOS, informeMes, informesPresentados, moduloListo, recetariosMes } from "@/lib/anexo13-datos";

// Informe mensual de control especial (Anexo 13) al Fondo Rotatorio de Estupefacientes. Dueño y administrador.
// GET  ?mes=AAAA-MM&sede=<uuid>           → JSON (filas, totales, revisión, tabla con la plantilla, informes presentados)
// GET  …&formato=excel[&confirmar=1]      → .xlsx con la hoja del informe y la relación de recetarios; si la revisión
//                                            encuentra algo que detiene, exige confirmar=1 (409 con los avisos)
// POST { mes, sede, presentado, canal, radicado, observacion } → lo marca como presentado (inmutable; corregir = nuevo)

const NO_LISTO = { error: "El informe mensual se está activando en tu Regenta: vuelve a intentarlo en unos minutos." };

function leerFiltro(u: URLSearchParams) {
  const hoy = hoyBogota();
  const mes = mesValido(u.get("mes")) ? u.get("mes")! : mesAnterior(hoy);
  const sede = u.get("sede");
  if (sede && !esUuid(sede)) return { error: "Sede no válida" } as const;
  if (mes > hoy.slice(0, 7)) return { error: "Ese mes aún no ha empezado" } as const;
  return { hoy, mes, sede: sede || null } as const;
}

export const GET = conSesion(conControlEspecial(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "El informe de control especial lo ven el dueño o el administrador" }, 403);
  const u = new URL(req.url).searchParams;
  const f = leerFiltro(u);
  if ("error" in f) return json({ error: f.error }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await moduloListo(c))) return null;
    const inf = await informeMes(c, s.empresa, f.sede, f.mes, f.hoy);
    const excel = u.get("formato") === "excel";
    return { inf, recetarios: excel ? await recetariosMes(c, s.empresa, f.sede, f.mes) : null, informes: excel ? [] : await informesPresentados(c, s.empresa) };
  });
  if (!r) return json(NO_LISTO, 409);
  const { inf } = r;
  if (u.get("formato") !== "excel") return json({ ...inf, informes: r.informes });
  if (detiene(inf.avisos) && u.get("confirmar") !== "1")
    return json({ error: "Revisa los avisos antes de descargar el informe", avisos: inf.avisos }, 409);
  const libro = libroXlsx([
    hojaDeFilas("Anexo 13", inf.tabla.datos, inf.tabla.columnas),
    hojaDeFilas("Recetarios", r.recetarios ?? [], COLUMNAS_RECETARIOS),
  ]);
  return respuestaExcel(libro, `anexo-13-${f.mes}${inf.encabezado.sede ? "-" + inf.encabezado.sede.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""}.xlsx`);
}));

const Presentado = z.object({
  mes: z.string().refine((m) => mesValido(m), "Elige el mes del informe"),
  sede: z.string().uuid().nullable().optional(),
  presentado: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escribe la fecha en que lo presentaste"),
  canal: z.enum(["correo", "plataforma", "presencial", "otro"], { message: "Elige cómo lo enviaste" }),
  radicado: z.string().trim().max(80, "El radicado admite hasta 80 caracteres").optional().default(""),
  observacion: z.string().trim().max(500, "La observación admite hasta 500 caracteres").optional().default(""),
});

export const POST = conSesion(conControlEspecial(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador registran el informe" }, 403);
  const p = Presentado.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, 400);
  const d = p.data;
  const id = await comoUsuario(s, async (c) => {
    if (!(await moduloListo(c))) return null;
    // Los totales los calcula el servidor (lo que se presentó queda guardado tal cual, no lo que mande la pantalla).
    const inf = await informeMes(c, s.empresa, d.sede ?? null, d.mes, hoyBogota());
    const totales = { ...inf.totales, avisos: inf.avisos.length };
    return (await c.query(`select registrar_informe_anexo13($1, $2, $3::date, $4) id`, [s.empresa, d.sede ?? null, `${d.mes}-01`,
      { presentado: d.presentado, canal: d.canal, radicado: d.radicado, observacion: d.observacion, totales }])).rows[0].id;
  });
  if (id === null) return json(NO_LISTO, 409);
  return json({ ok: true, id: Number(id) });
}));
