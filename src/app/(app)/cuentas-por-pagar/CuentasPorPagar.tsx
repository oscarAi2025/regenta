"use client";
import { Fragment, useState } from "react";
import type { FilaCxP } from "@/lib/compras-datos";
import { pesosExactos } from "@/lib/compras";
import { Pagar } from "./Pagar";

const fecha = (d: string) => d.split("-").reverse().join("/");
const grupo = (dias: number) => (dias < 0 ? "vencidas" : dias <= 7 ? "semana" : "al_dia");
const GRUPOS = [["vencidas", "Vencidas", "text-alerta"], ["semana", "Vencen en los próximos 7 días", "text-aviso"], ["al_dia", "Al día", "text-ink"]] as const;

export function CuentasPorPagar({ inicial }: { inicial: FilaCxP[] }) {
  const [filas, setFilas] = useState(inicial);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const suma = (g?: string) => filas.filter((f) => !g || grupo(f.dias) === g).reduce((a, f) => a + f.saldo, 0);
  const listo = (proveedor: string) => (cuentas: FilaCxP[], mensaje: string) => {
    setFilas((fs) => [...fs.filter((f) => f.proveedor_id !== proveedor), ...cuentas].sort((a, b) => a.vence_pago.localeCompare(b.vence_pago) || a.numero - b.numero));
    setAbierta(null); setAviso(mensaje);
  };
  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Resumen">
        {[["Por pagar", suma(), "text-ink", `${filas.length} factura${filas.length === 1 ? "" : "s"}`], ["Vencido", suma("vencidas"), "text-alerta", suma("vencidas") ? "págalo cuanto antes" : "nada vencido"],
          ["Vence en 7 días", suma("semana"), "text-aviso", suma("semana") ? "programa el pago" : "nada esta semana"], ["Al día", suma("al_dia"), "text-cruz", "más de 7 días"]].map(([t, v, c, n]) => (
          <div key={t as string} className="tarjeta px-4 py-3.5"><p className="text-sm text-muted">{t}</p><p className={`num titulo text-[28px] leading-tight ${v ? c : "text-ink"}`}>{pesosExactos(v as number)}</p><p className="text-[13px] text-muted">{n}</p></div>
        ))}
      </section>
      {aviso && <p role="status" className="rounded-xl bg-cruz-soft text-cruz font-semibold px-4 py-3">{aviso}</p>}
      {filas.length === 0 && <p className="tarjeta p-10 text-center text-muted">No le debes nada a ningún proveedor. Las compras a crédito aparecen aquí hasta que las pagues.</p>}
      {GRUPOS.map(([g, titulo, color]) => {
        const fs = filas.filter((f) => grupo(f.dias) === g);
        if (!fs.length) return null;
        return (
          <section key={g} className="tarjeta overflow-x-auto" aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`} className={`titulo text-xl px-4 pt-4 ${color}`}>{titulo} · <span className="num">{pesosExactos(fs.reduce((a, f) => a + f.saldo, 0))}</span></h2>
            <table className="w-full text-[15px] min-w-[780px]" aria-label={titulo}>
              <thead className="text-left text-sm text-muted border-b border-line"><tr>
                <th className="px-4 py-2.5 font-semibold">Proveedor</th><th className="px-4 py-2.5 font-semibold">Factura</th><th className="px-4 py-2.5 font-semibold">Vence</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total</th><th className="px-4 py-2.5 font-semibold text-right">Pagado</th><th className="px-4 py-2.5 font-semibold text-right">Saldo</th><th className="px-4 py-2.5" />
              </tr></thead>
              <tbody className="divide-y divide-line">
                {fs.map((f) => (
                  <Fragment key={f.compra_id}>
                    <tr className="align-top">
                      <td className="px-4 py-3"><a href={`/proveedores/${f.proveedor_id}`} className="font-semibold hover:underline">{f.proveedor}</a>{f.nit && <p className="text-sm text-muted num">NIT {f.nit}{f.dv ? `-${f.dv}` : ""}</p>}</td>
                      <td className="px-4 py-3"><a href={`/compras/${f.compra_id}`} className="num font-semibold hover:underline">{f.numero_factura}</a><p className="text-sm text-muted">{fecha(f.fecha_factura)} · {f.condicion === "credito" ? "crédito" : "contado"}</p></td>
                      <td className="px-4 py-3 num">{fecha(f.vence_pago)}<p className={`text-sm ${f.dias < 0 ? "text-alerta font-semibold" : "text-muted"}`}>{f.dias < 0 ? `hace ${-f.dias} día${f.dias === -1 ? "" : "s"}` : f.dias === 0 ? "hoy" : `en ${f.dias} día${f.dias === 1 ? "" : "s"}`}</p></td>
                      <td className="px-4 py-3 num text-right">{pesosExactos(f.total)}</td>
                      <td className="px-4 py-3 num text-right text-muted">{pesosExactos(f.pagado + f.notas_credito)}</td>
                      <td className="px-4 py-3 num text-right font-semibold">{pesosExactos(f.saldo)}</td>
                      <td className="px-4 py-3 text-right"><button onClick={() => { setAbierta(abierta === f.compra_id ? null : f.compra_id); setAviso(""); }} className="btn-oscuro h-9 px-3 text-sm" aria-label={`Pagar factura ${f.numero_factura} de ${f.proveedor}`}>Pagar</button></td>
                    </tr>
                    {abierta === f.compra_id && <tr><td colSpan={7} className="px-4 pb-4"><Pagar proveedor={f.proveedor_id} compra={f.compra_id} saldo={f.saldo} etiqueta={`Pago de la factura ${f.numero_factura}`} onListo={listo(f.proveedor_id)} onCerrar={() => setAbierta(null)} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
