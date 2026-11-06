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
  const d = await comoUsuario(s, (c) => datosReporte(c, s.empresa, r, true)).catch((e) => { console.error("reportes", e); return null; });
  if (!d) return NextResponse.json({ error: "No se pudo armar el reporte. Inténtalo de nuevo." }, { status: 503 });
  const tablas: Record<string, [Record<string, unknown>[], [string, string][]]> = {
    // Ganancia neta de lo devuelto y solo de las líneas con costo; lo vendido sin costo (sin IVA) va en su columna.
    productos: [d.productos.map((x) => ({ ...x, ganancia: x.con_costo ? x.ganancia : null, sin_costo: x.sin_costo || null, heredado: x.heredado ? "Sí: puede incluir IVA" : "" })),
      [["producto", "Producto"], ["unidades", "Unidades"], ["devueltas", "Devueltas"], ["total", "Vendido"], ["ganancia", "Ganancia"], ["sin_costo", "Vendido sin costo registrado"], ["heredado", "Costo anterior a compras"]]],
    cajeros: [d.cajeros.map((x) => ({ ...x, cajero: String(x.cajero).split(" (")[0] })), [["cajero", "Cajero"], ["ventas", "Ventas"], ["promedio", "Ticket promedio"], ["total", "Total"]]],
    medios: [d.medios.map((x) => ({ ...x, medio: MEDIO[x.medio] ?? x.medio })), [["medio", "Medio de pago"], ["ventas", "Ventas"], ["valor", "Valor"]]],
    dias: [d.dias, [["dia", "Día"], ["ventas", "Ventas"], ["total", "Total"]]],
  };
  const t = tablas[tipo];
  if (!t) return NextResponse.json({ error: "Reporte no válido" }, { status: 400 });
  return new Response(csv(t[0], t[1]), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="regenta-${tipo}-${r.desde}-a-${r.hasta}.csv"`, "cache-control": "no-store" } });
}
