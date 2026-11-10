import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { estadoCuenta, hoyBogota, permisoCartera } from "@/lib/cartera";
import { pesos } from "@/lib/formato";
import { AutoImprimir } from "../../[id]/AutoImprimir";

// Estado de cuenta de un cliente para imprimir (tirilla de 80 o 58 mm): facturas pendientes, movimientos y saldo.
export const metadata: Metadata = { title: "Estado de cuenta", robots: { index: false, follow: false } };

export default async function EstadoCuentaTiquete({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ancho?: string; auto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!permisoCartera.gestionar(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  const { ancho = "80", auto } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const mm = ancho === "58" ? 58 : 80;
  const d = await comoUsuario(s, async (c) => {
    const ec = await estadoCuenta(c, s.empresa, id);
    if (!ec) return null;
    const e = (await c.query(`select razon_social, nombre_comercial, nit, dv, telefono from empresas where id = $1`, [s.empresa])).rows[0];
    return { ec, e };
  });
  if (!d) notFound();
  const { ec, e } = d;
  const cl = ec.cliente;
  const fila = (a: string, b: string, fuerte = false) => <p className={`fila${fuerte ? " fuerte" : ""}`}><span>{a}</span><span>{b}</span></p>;
  const ultimos = ec.movimientos.slice(-15);

  return (
    <main className="tiq" style={{ width: `${mm - 8}mm` }}>
      <style>{`
        @page { size: ${mm}mm auto; margin: 0; }
        html, body { background: #fff !important; margin: 0; }
        .tiq { margin: 0 auto; padding: 3mm 4mm 6mm; color: #000; font: ${mm === 58 ? 10.5 : 12}px/1.35 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; }
        .tiq p { margin: 0; } .c { text-align: center; } .b { font-weight: 700; } .g { font-size: 1.25em; } .m { font-size: .85em; }
        .tiq hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
        .fila { display: flex; justify-content: space-between; gap: 8px; } .fila span:last-child { text-align: right; white-space: nowrap; }
        .fuerte { font-weight: 700; font-size: 1.15em; } .tachado { text-decoration: line-through; }
        .barra { display: flex; gap: 8px; justify-content: center; margin: 10px 0; }
        .barra button { font: 600 14px system-ui; padding: 8px 14px; border-radius: 8px; border: 1px solid #000; background: #fff; cursor: pointer; }
        @media print { .barra { display: none; } }
      `}</style>
      <div className="barra"><AutoImprimir auto={auto === "1"} /></div>
      <p className="c b g">{e.nombre_comercial || e.razon_social}</p>
      <p className="c">NIT {e.nit}{e.dv ? `-${e.dv}` : ""}</p>
      {e.telefono && <p className="c">Tel. {e.telefono}</p>}
      <hr />
      <p className="c b g">ESTADO DE CUENTA</p>
      {fila("Fecha", hoyBogota())}
      <p className="b" style={{ marginTop: 4 }}>{cl.nombre}</p>
      <p>{cl.tipo_doc} {cl.numero_doc}{cl.dv ? `-${cl.dv}` : ""}</p>
      {cl.cupo !== null && fila("Cupo", pesos(cl.cupo))}
      <hr />
      <p className="b">Facturas pendientes</p>
      {ec.pendientes.length === 0 && <p>Ninguna. Está a paz y salvo.</p>}
      {ec.pendientes.map((p) => (
        <div key={p.venta_id}>
          {fila(p.factura, pesos(p.saldo))}
          <p className="m">  {p.fecha} · vence {p.vence}{p.dias_mora > 0 ? ` · ${p.dias_mora} días de mora` : ""}</p>
        </div>
      ))}
      <hr />
      <p className="b">Últimos movimientos</p>
      {ultimos.map((m, i) => (
        <div key={i} className={m.anulado ? "tachado" : undefined}>
          <p className="m">{m.fecha} · {m.detalle}{m.anulado ? " (anulado)" : ""}</p>
          {fila(m.cargo ? "  cargo" : "  pago", (m.cargo ? "" : "−") + pesos(m.valor))}
        </div>
      ))}
      <hr />
      {fila("Total facturado", pesos(ec.cargos))}
      {fila("Pagos y devoluciones", "−" + pesos(ec.abonos))}
      {fila("Saldo", pesos(ec.saldo), true)}
      <p className="c" style={{ marginTop: 12, fontSize: ".85em" }}>Regenta</p>
    </main>
  );
}
