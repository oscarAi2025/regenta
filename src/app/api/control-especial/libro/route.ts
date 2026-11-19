import { conControlEspecial } from "@/lib/control-plan";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { excel, pideExcel, rango, respuestaExcel } from "@/lib/reportes";
import { TIPO_ASIENTO } from "@/lib/anexo13";
import { libroCompleto, moduloListo } from "@/lib/anexo13-datos";

// Libro completo de control especial: cada movimiento de inventario de esos productos (compras, dispensaciones,
// reintegros, devoluciones, ajustes y bajas) con su soporte y el saldo resultante. JSON o Excel. Dueño y administrador.

const COLUMNAS: [string, string][] = [
  ["fecha", "Fecha y hora"], ["producto", "Medicamento"], ["movimiento", "Movimiento"], ["lote", "Lote"], ["vence", "Vence"],
  ["entrada", "Entrada (unidades)"], ["salida", "Salida (unidades)"], ["saldo", "Saldo (unidades)"], ["soporte", "Soporte"],
  ["formula_numero", "N.º de recetario"], ["medico", "Prescriptor"], ["paciente", "Paciente"], ["usuario", "Registró"],
];

export const GET = conSesion(conControlEspecial(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "El libro de control especial lo ven el dueño o el administrador" }, 403);
  const u = new URL(req.url).searchParams;
  const r = rango(u.get("desde"), u.get("hasta"));
  const producto = u.get("producto"), sede = u.get("sede");
  if ((producto && !esUuid(producto)) || (sede && !esUuid(sede))) return json({ error: "Filtro no válido" }, 400);
  const d = await comoUsuario(s, async (c) => ((await moduloListo(c)) ? await libroCompleto(c, s.empresa, sede || null, r.desde, r.hasta, producto || null) : null));
  if (!d) return json({ error: "El libro completo se está activando en tu Regenta: vuelve a intentarlo en unos minutos." }, 409);
  if (!pideExcel(u.get("formato"))) return json({ ...r, ...d });
  const nombres = Object.fromEntries(d.productos.map((p) => [p.id, p.nombre]));
  const filas = d.asientos.map((a) => ({ ...a, producto: nombres[a.producto_id] ?? "", movimiento: TIPO_ASIENTO[a.asiento], entrada: a.entrada || null, salida: a.salida || null }));
  return respuestaExcel(excel("Libro de control especial", filas, COLUMNAS), `regenta-libro-control-especial-${r.desde}-a-${r.hasta}.xlsx`);
}));
