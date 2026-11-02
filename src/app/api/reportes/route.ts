import { NextResponse } from "next/server";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { csv, datosReporte, rango } from "@/lib/reportes";
import { MEDIO } from "@/lib/formato";

/** Exporta un reporte a CSV (se abre en Excel). Solo dueño y administrador. */
export async function GET(req: Request) {
  const s = await leerSesion();
  if (!s) return NextResponse.json({ error: "Tu sesión venció: vuelve a entrar" }, { status: 401 });
  if (!puede.verCostos(s.rol)) return NextResponse.json({ error: "Los reportes son del dueño o el administrador" }, { status: 403 });
  const u = new URL(req.url);
  const r = rango(u.searchParams.get("desde"), u.searchParams.get("hasta"));
  const tipo = u.searchParams.get("tipo") ?? "productos";
  const d = await comoUsuario(s, (c) => datosReporte(c, s.empresa, r, true));
  const tablas: Record<string, [Record<string, unknown>[], [string, string][]]> = {
    productos: [d.productos.map((x) => ({ ...x, ganancia: x.sin_costo ? null : Math.round(x.base - x.costo) })), [["producto", "Producto"], ["unidades", "Unidades"], ["devueltas", "Devueltas"], ["total", "Vendido"], ["ganancia", "Ganancia"]]],
    cajeros: [d.cajeros.map((x) => ({ ...x, cajero: String(x.cajero).split(" (")[0] })), [["cajero", "Cajero"], ["ventas", "Ventas"], ["promedio", "Ticket promedio"], ["total", "Total"]]],
    medios: [d.medios.map((x) => ({ ...x, medio: MEDIO[x.medio] ?? x.medio })), [["medio", "Medio de pago"], ["ventas", "Ventas"], ["valor", "Valor"]]],
    dias: [d.dias, [["dia", "Día"], ["ventas", "Ventas"], ["total", "Total"]]],
  };
  const t = tablas[tipo];
  if (!t) return NextResponse.json({ error: "Reporte no válido" }, { status: 400 });
  return new Response(csv(t[0], t[1]), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="regenta-${tipo}-${r.desde}-a-${r.hasta}.csv"`, "cache-control": "no-store" } });
}
