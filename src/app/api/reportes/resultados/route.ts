import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedeResultados } from "@/lib/gastos";
import { csv, lineasResultado, rango, respuestaCsv, resultados } from "@/lib/reportes";

/** Estado de resultados del rango (por defecto el mes en curso): JSON o CSV con ?formato=csv. Solo dueño o administrador. */
export const GET = conSesion(async (s, req) => {
  if (!puedeResultados(s.rol)) return json({ error: "Los resultados los ve el dueño o el administrador" }, 403);
  const sp = new URL(req.url).searchParams;
  const r = rango(sp.get("desde"), sp.get("hasta"));
  const d = await comoUsuario(s, (c) => resultados(c, s.empresa, r));
  if (sp.get("formato") === "csv") {
    const filas = [...lineasResultado(d).map((l) => ({ concepto: l.concepto, valor: l.valor, nota: l.nota ?? "" })),
      { concepto: "Desde", valor: null, nota: r.desde }, { concepto: "Hasta", valor: null, nota: r.hasta }];
    return respuestaCsv(csv(filas, [["concepto", "Concepto"], ["valor", "Valor"], ["nota", "Nota"]]), `regenta-resultados-${r.desde}-a-${r.hasta}.csv`);
  }
  return json(d);
});
