import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedeResultados } from "@/lib/gastos";
import { auxiliarIva, excel, pideExcel, rango, respuestaExcel, sumaIva, type FilaIva } from "@/lib/reportes";

/** Auxiliar de IVA del periodo: ventas por tarifa menos notas crédito e IVA de las compras registradas. JSON o Excel
 *  (?formato=excel) para el contador. Solo dueño o administrador. */
export const GET = conSesion(async (s, req) => {
  if (!puedeResultados(s.rol)) return json({ error: "El auxiliar de IVA lo ve el dueño o el administrador" }, 403);
  const sp = new URL(req.url).searchParams;
  const r = rango(sp.get("desde"), sp.get("hasta"));
  const d = await comoUsuario(s, (c) => auxiliarIva(c, s.empresa, r));
  if (pideExcel(sp.get("formato"))) {
    const seccion = (nombre: string, f: FilaIva[]) => [...f.map((x) => ({ seccion: nombre, tarifa: `${x.tarifa} %`, base: x.base, iva: x.iva })),
      { seccion: nombre, tarifa: "Total", ...sumaIva(f) }];
    const filas = [
      ...seccion("Ventas", d.ventas), ...seccion("Notas débito", d.notas_debito), ...seccion("Notas crédito (devoluciones y anulaciones)", d.notas), ...seccion("Ventas netas (IVA generado)", d.ventas_netas),
      ...(d.responsable ? [...seccion("Compras registradas", d.compras), ...seccion("Notas crédito de proveedores", d.nc_proveedor), ...seccion("IVA descontable de compras", d.descontable)] : []),
      ...(d.responsable ? [] : [{ seccion: "No responsable de IVA: las ventas no llevan IVA y el IVA de las compras va al costo (no es descontable)", tarifa: "", base: null, iva: null }]),
      { seccion: `Periodo ${r.desde} a ${r.hasta}`, tarifa: "", base: null, iva: null },
      { seccion: "Auxiliar para tu contador, no reemplaza la declaración", tarifa: "", base: null, iva: null },
    ];
    return respuestaExcel(excel("Auxiliar de IVA", filas, [["seccion", "Concepto"], ["tarifa", "Tarifa"], ["base", "Base"], ["iva", "IVA"]]), `regenta-auxiliar-iva-${r.desde}-a-${r.hasta}.xlsx`);
  }
  return json(d);
});
