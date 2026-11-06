import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { permisoCartera } from "@/lib/cartera";
import { MEDIO, pesos } from "@/lib/formato";
import { AutoImprimir } from "../../[id]/AutoImprimir";

// Recibo de caja para la impresora térmica: cuánto pagó el cliente, a qué facturas se aplicó y cuánto queda debiendo.
export const metadata: Metadata = { title: "Recibo de caja", robots: { index: false, follow: false } };

export default async function ReciboCaja({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ancho?: string; auto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!permisoCartera.recibir(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  const { ancho = "80", auto } = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const mm = ancho === "58" ? 58 : 80;

  const x = await comoUsuario(s, async (c) => (await c.query(
    `select r.numero, r.medio, r.valor::float valor, r.referencia, r.saldo_anterior::float saldo_anterior, r.aplicado, r.anulado, r.motivo,
            to_char(r.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, cl.nombre cliente, cl.tipo_doc || ' ' || cl.numero_doc || coalesce('-' || cl.dv, '') documento,
            e.razon_social, e.nombre_comercial, e.nit, e.dv, e.direccion, e.ciudad, e.telefono, m.nombre quien, cj.nombre caja
     from recibos_caja r join clientes cl on cl.id = r.cliente_id join empresas e on e.id = r.empresa_id
     left join miembros m on m.empresa_id = r.empresa_id and m.user_id = r.usuario_id left join cajas cj on cj.id = r.caja_id
     where r.id = $1 and r.empresa_id = $2`, [id, s.empresa])).rows[0]);
  if (!x) notFound();
  const aplicado = (x.aplicado ?? []) as { factura: string; valor: number; saldo: number; vence?: string }[];
  const fila = (a: string, b: string, fuerte = false) => <p className={`fila${fuerte ? " fuerte" : ""}`}><span>{a}</span><span>{b}</span></p>;

  return (
    <main className="tiq" style={{ width: `${mm - 8}mm` }}>
      <style>{`
        @page { size: ${mm}mm auto; margin: 0; }
        html, body { background: #fff !important; margin: 0; }
        .tiq { margin: 0 auto; padding: 3mm 4mm 6mm; color: #000; font: ${mm === 58 ? 10.5 : 12}px/1.35 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; }
        .tiq p { margin: 0; } .c { text-align: center; } .b { font-weight: 700; } .g { font-size: 1.25em; }
        .tiq hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
        .fila { display: flex; justify-content: space-between; gap: 8px; } .fila span:last-child { text-align: right; white-space: nowrap; }
        .fuerte { font-weight: 700; font-size: 1.15em; }
        .barra { display: flex; gap: 8px; justify-content: center; margin: 10px 0; }
        .barra button { font: 600 14px system-ui; padding: 8px 14px; border-radius: 8px; border: 1px solid #000; background: #fff; cursor: pointer; }
        @media print { .barra { display: none; } }
      `}</style>
      <div className="barra"><AutoImprimir auto={auto === "1" && !x.anulado} /></div>
      <p className="c b g">{x.nombre_comercial || x.razon_social}</p>
      {x.nombre_comercial && x.razon_social !== x.nombre_comercial && <p className="c">{x.razon_social}</p>}
      <p className="c">NIT {x.nit}{x.dv ? `-${x.dv}` : ""}</p>
      {(x.direccion || x.ciudad) && <p className="c">{[x.direccion, x.ciudad].filter(Boolean).join(" · ")}</p>}
      <hr />
      <p className="c b g">RECIBO DE CAJA RC-{x.numero}</p>
      {x.anulado && <p className="c b">ANULADO: {x.motivo}</p>}
      {fila("Fecha", x.fecha)}
      {x.caja && fila("Caja", x.caja)}
      {x.quien && fila("Recibió", String(x.quien).split(" (")[0])}
      <hr />
      <p className="b">{x.cliente}</p>
      <p>{x.documento}</p>
      <hr />
      {aplicado.map((a) => (
        <div key={a.factura}>{fila(`Factura ${a.factura}`, pesos(Number(a.valor)))}{Number(a.saldo) > 0 ? fila("  queda", pesos(Number(a.saldo))) : fila("  ", "pagada")}</div>
      ))}
      <hr />
      {fila(`Recibido (${(MEDIO[x.medio] ?? x.medio).toLowerCase()})`, pesos(x.valor), true)}
      {x.referencia && fila("Referencia", x.referencia)}
      {fila("Saldo anterior", pesos(x.saldo_anterior))}
      {fila("Saldo pendiente", pesos(x.saldo_anterior - x.valor), true)}
      <hr />
      <p style={{ marginTop: 18 }}>Firma: ______________________</p>
      <p className="c" style={{ marginTop: 8, fontSize: ".85em" }}>Regenta</p>
    </main>
  );
}
