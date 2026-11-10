import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { csv } from "@/lib/reportes";
import { puedeCompras } from "@/lib/compras";
import { cuentasPorPagar, grupoCxP } from "@/lib/compras-datos";

const GRUPO: Record<string, string> = { vencidas: "Vencida", semana: "Vence en 7 días", al_dia: "Al día" };

/** Cuentas por pagar a proveedores con saldo (JSON, o CSV con ?formato=csv). Solo dueño o administrador. */
export const GET = conSesion(async (s, req) => {
  if (!puedeCompras.dinero(s.rol)) return json({ error: "Las cuentas por pagar las ve el dueño o el administrador" }, 403);
  const sp = new URL(req.url).searchParams;
  const prov = sp.get("proveedor");
  const filas = await comoUsuario(s, (c) => cuentasPorPagar(c, s.empresa, prov && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(prov) ? prov : null));
  if (sp.get("formato") === "csv") {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    const datos = filas.map((f) => ({ ...f, nit: f.nit ? `${f.nit}${f.dv ? "-" + f.dv : ""}` : "", estado: GRUPO[grupoCxP(f.dias)],
      condicion: f.condicion === "credito" ? "Crédito" : "Contado", dias_vencida: f.dias_vencida || "" }));
    return new Response(csv(datos, [["proveedor", "Proveedor"], ["nit", "NIT"], ["numero_factura", "Factura"], ["numero", "Compra N.º"], ["fecha_factura", "Fecha factura"],
      ["vence_pago", "Vence"], ["condicion", "Condición"], ["total", "Total"], ["pagado", "Pagado"], ["notas_credito", "Notas crédito"], ["saldo", "Saldo"],
      ["estado", "Estado"], ["dias_vencida", "Días vencida"]]), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="cuentas-por-pagar-${hoy}.csv"`, "cache-control": "no-store" } });
  }
  const total = (g: string) => filas.filter((f) => grupoCxP(f.dias) === g).reduce((a, f) => a + f.saldo, 0);
  return json({ cuentas: filas, resumen: { total: filas.reduce((a, f) => a + f.saldo, 0), vencidas: total("vencidas"), semana: total("semana"), al_dia: total("al_dia") } });
});
