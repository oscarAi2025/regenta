import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { pesos } from "@/components/ui/Cabecera";
import { Anular } from "./Anular";
import { Devolver } from "./Devolver";
import { Reenviar } from "./Reenviar";
import { Abonos } from "./Abonos";
import { Imprimir } from "./Imprimir";
import { MEDIO } from "@/lib/formato";

export const metadata = { title: "Venta" };

export default async function Venta({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso"); // bodega no ve ventas ni clientes
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await comoUsuario(s, async (c) => {
    const v = (await c.query(`select v.*, to_char(v.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, m.nombre cajero, e.razon_social, e.nit, e.dv, e.direccion, e.ciudad,
      cl.nombre cliente, cl.tipo_doc cli_tipo, cl.numero_doc cli_num, cl.dv cli_dv, to_char(v.vence_pago, 'DD/MM/YYYY') vence
      from ventas v join empresas e on e.id = v.empresa_id left join clientes cl on cl.id = v.cliente_id left join miembros m on m.empresa_id = v.empresa_id and m.user_id = v.usuario_id where v.id = $1 and v.empresa_id = $2`, [id, s.empresa])).rows[0];
    if (!v) return null;
    const lineas = (await c.query(`select vl.producto_id::text, vl.descripcion, vl.presentacion, sum(vl.cantidad)::float cantidad, vl.precio::float, sum(vl.total)::float total, sum(vl.descuento)::float descuento, vl.iva_pct::float, string_agg(l.lote, ', ') lotes,
        coalesce(sum((select sum(dl.cantidad) from devolucion_lineas dl where dl.venta_linea_id = vl.id)), 0)::float devuelto
      from venta_lineas vl join lotes l on l.id = vl.lote_id where vl.venta_id = $1 group by vl.descripcion, vl.presentacion, vl.precio, vl.iva_pct, vl.producto_id order by min(vl.id)`, [id])).rows;
    const devoluciones = (await c.query(`select d.id::text, to_char(d.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, d.total::float, d.reembolso::float, d.a_saldo::float, d.medio, d.motivo,
        (select dd.prefijo || dd.numero || ' · ' || dd.estado from documentos_dian dd where dd.devolucion_id = d.id) nota
      from devoluciones d where d.venta_id = $1 order by d.creado`, [id])).rows;
    const pagos = (await c.query(`select medio, valor::float from pagos where venta_id = $1`, [id])).rows;
    const doc = (await c.query(`select estado, cufe, simulado, ultimo_error, intentos from documentos_dian where venta_id = $1 and tipo <> 'nota_credito' order by creado limit 1`, [id])).rows[0];
    const nota = (await c.query(`select prefijo || numero documento, estado, cufe, simulado, ultimo_error from documentos_dian
      where venta_id = $1 and tipo = 'nota_credito' and devolucion_id is null order by creado desc limit 1`, [id])).rows[0];
    const abonos = v.condicion === "credito" && puede.cartera(s.rol) ? (await c.query(`select id::text, to_char(creado at time zone 'America/Bogota', 'DD/MM/YYYY') fecha, medio, valor::float, referencia, anulado, anulado_motivo from abonos where venta_id = $1 order by creado`, [id])).rows : [];
    // Fórmula médica de la venta (solo la ve la gerencia: lleva datos del paciente).
    const formulas = puede.verCostos(s.rol) ? (await c.query(`select p.nombre, f.control, f.paciente_tipo_doc, f.paciente_doc, f.paciente_nombre, f.medico_nombre, f.medico_registro,
        f.formula_numero, to_char(f.formula_fecha, 'DD/MM/YYYY') formula_fecha from venta_formulas f join productos p on p.id = f.producto_id where f.venta_id = $1 order by f.control desc, p.nombre`, [id])).rows : [];
    return { v, lineas, pagos, doc, nota, abonos, devoluciones, formulas };
  });
  if (!d) notFound();
  const { v } = d;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[440px_minmax(0,1fr)] gap-6 items-start">
      <article className="tirilla rounded-t-2xl px-6 pt-6 pb-10" aria-label="Tiquete">
        <p className="text-center titulo text-lg">{v.razon_social}</p>
        <p className="text-center text-sm text-muted">NIT {v.nit}-{v.dv} · {v.direccion}, {v.ciudad}</p>
        <div className="corte my-4" />
        <p className="flex justify-between text-sm"><span>{v.tipo_doc === "pos" ? "Tiquete POS electrónico" : "Factura electrónica"}</span><span className="num font-semibold">{v.prefijo}{v.numero}</span></p>
        <p className="flex justify-between text-sm text-muted"><span>{v.fecha}</span><span>{String(v.cajero ?? "").split(" (")[0]}</span></p>
        {v.cliente && <p className="mt-2 text-sm"><span className="text-muted">Cliente: </span>{v.cliente} · <span className="num">{v.cli_tipo} {v.cli_num}{v.cli_dv ? `-${v.cli_dv}` : ""}</span></p>}
        {v.condicion === "credito" && <p className="text-sm"><span className="text-muted">Forma de pago: </span>crédito a {v.plazo_dias} días · vence {v.vence}</p>}
        <div className="corte my-4" />
        <ul className="grid gap-3">
          {d.lineas.map((l, i) => (
            <li key={i}>
              <p className="text-[15px] leading-snug">{l.descripcion}</p>
              <p className="flex justify-between text-sm text-muted num"><span>{l.cantidad} {l.presentacion === "caja" ? "caja" : "und"} × {pesos(l.precio)}{l.iva_pct ? ` · IVA ${l.iva_pct} %` : ""} · lote {l.lotes}</span><span className="text-ink font-semibold">{pesos(l.total)}</span></p>
              {l.descuento > 0 && <p className="text-sm text-cruz num">Descuento −{pesos(l.descuento)}</p>}
              {l.devuelto > 0 && <p className="text-sm text-alerta num">Devuelto: {l.devuelto} {l.presentacion === "caja" ? "caja" : "und"}</p>}
            </li>
          ))}
        </ul>
        <div className="corte my-4" />
        <dl className="grid grid-cols-2 gap-y-1 text-sm num"><dt className="text-muted">Base</dt><dd className="text-right">{pesos(v.base)}</dd><dt className="text-muted">IVA</dt><dd className="text-right">{pesos(v.iva)}</dd></dl>
        {Number(v.devuelto) > 0 && <dl className="grid grid-cols-2 gap-y-1 text-sm num mt-1"><dt className="text-alerta">Devuelto</dt><dd className="text-right text-alerta">−{pesos(v.devuelto)}</dd></dl>}
        <p className="mt-2 flex justify-between items-baseline"><span className="text-lg">Total</span><span className={`num titulo text-4xl ${v.estado === "anulada" ? "line-through text-muted" : ""}`}>{pesos(v.total)}</span></p>
        {Number(v.devuelto) > 0 && v.estado !== "anulada" && <p className="mt-1 flex justify-between items-baseline font-semibold"><span>Total neto (después de devoluciones)</span><span className="num titulo text-2xl">{pesos(Number(v.total) - Number(v.devuelto))}</span></p>}
        <div className="corte my-4" />
        <ul className="text-sm num grid gap-1">
          {d.pagos.map((p, i) => <li key={i} className="flex justify-between"><span>{MEDIO[p.medio] ?? p.medio}</span><span>{pesos(p.valor)}</span></li>)}
          {Number(v.cambio) > 0 && <li className="flex justify-between font-semibold"><span>Cambio</span><span>{pesos(v.cambio)}</span></li>}
        </ul>
        {d.doc?.cufe && <p className="mt-4 text-[11px] text-muted break-all">{v.tipo_doc === "factura" ? "CUFE" : "CUDE"} {d.doc.cufe}{d.doc.simulado ? " (simulado, pruebas)" : ""}</p>}
      </article>
      <section className="grid gap-4">
        <Link href="/ventas" className="text-sm font-semibold text-cruz">← Volver a ventas</Link>
        <Imprimir id={v.id} />
        <div className="tarjeta p-5">
          <h2 className="titulo text-xl">Estado</h2>
          {v.estado === "anulada" ? (
            <div className="mt-2 grid gap-1">
              <p className="text-alerta font-semibold">Venta anulada. Las unidades volvieron a sus lotes.</p>
              {d.nota ? (
                <p>
                  Nota crédito <span className="num font-semibold">{d.nota.documento}</span>:{" "}
                  {d.nota.estado === "aceptado" ? <span className="text-cruz font-semibold">aceptada por la DIAN, el documento quedó anulado</span>
                    : d.nota.estado === "rechazado" ? <span className="text-alerta font-semibold">rechazada por la DIAN: {d.nota.ultimo_error}</span>
                    : <span className="text-aviso font-semibold">enviándose a la DIAN; la cola la reintenta sola</span>}
                  {d.nota.simulado && <span className="text-muted"> · emisión simulada</span>}
                </p>
              ) : d.doc?.estado === "anulado" ? <p className="text-muted">El documento no había salido a la DIAN: no hizo falta nota crédito.</p> : null}
              {d.nota?.cufe && <p className="text-[11px] text-muted break-all">CUDE {d.nota.cufe}</p>}
              {d.nota?.estado === "rechazado" && puede.anular(s.rol) && <Reenviar id={v.id} />}
            </div>
          ) : (
            <p className="mt-2">
              {d.doc?.estado === "aceptado" ? <span className="text-cruz font-semibold">Aceptado por la DIAN</span>
                : d.doc?.estado === "rechazado" ? <span className="text-alerta font-semibold">Rechazado por la DIAN: {d.doc.ultimo_error}</span>
                : <span className="text-aviso font-semibold">Esperando a la DIAN (intentos: {d.doc?.intentos ?? 0}). La cola lo reintenta sola.</span>}
              {d.doc?.simulado && <span className="text-muted"> · emisión simulada mientras se conecta MATIAS</span>}
            </p>
          )}
          {v.estado !== "anulada" && d.doc?.estado === "rechazado" && puede.anular(s.rol) && <Reenviar id={v.id} />}
        </div>
        {d.formulas.length > 0 && (
          <div className="tarjeta p-5">
            <h2 className="titulo text-xl">Fórmula médica</h2>
            {d.formulas.find((f) => f.paciente_doc) ? (() => { const f = d.formulas.find((x) => x.paciente_doc)!; return (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Paciente</dt><dd>{f.paciente_nombre} · <span className="num">{f.paciente_tipo_doc} {f.paciente_doc}</span></dd>
                <dt className="text-muted">Médico</dt><dd>{f.medico_nombre} · Reg. {f.medico_registro}</dd>
                <dt className="text-muted">Fórmula</dt><dd className="num">N.º {f.formula_numero} del {f.formula_fecha}</dd>
              </dl>); })() : <p className="mt-2 text-sm">Quien vendió confirmó que verificó la fórmula.</p>}
            <p className="mt-2 text-sm text-muted">{d.formulas.map((f) => `${f.nombre}${f.control ? " (control especial)" : ""}`).join(" · ")}</p>
            {d.formulas.some((f) => f.control) && <Link href="/control-especial" className="mt-2 inline-block text-sm font-semibold text-cruz">Ver el libro de control especial →</Link>}
          </div>
        )}
        {v.condicion === "credito" && puede.cartera(s.rol) && <Abonos abonos={d.abonos.map((a) => ({ ...a, medio: MEDIO[a.medio] ?? a.medio }))} puedeAnular={v.estado === "cerrada"} />}
        {d.devoluciones.length > 0 && (
          <div className="tarjeta p-5">
            <h2 className="titulo text-xl">Devoluciones</h2>
            <ul className="mt-3 divide-y divide-line text-sm">
              {d.devoluciones.map((x) => (
                <li key={x.id} className="py-2 grid gap-1">
                  <p className="flex justify-between gap-2"><span>{x.fecha} · {x.motivo}</span><span className="num font-semibold text-alerta">−{pesos(x.total)}</span></p>
                  <p className="text-muted">{x.reembolso > 0 ? `Reembolso ${pesos(x.reembolso)} en ${(MEDIO[x.medio] ?? x.medio).toLowerCase()}` : ""}{x.a_saldo > 0 ? `${x.reembolso > 0 ? " · " : ""}${pesos(x.a_saldo)} descontado del saldo` : ""}{x.nota ? ` · Nota crédito ${x.nota}` : ""}</p>
                  <a href={`/tiquete/devolucion/${x.id}`} className="text-cruz font-semibold">Ver comprobante</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {v.estado === "cerrada" && puede.anular(s.rol) && d.lineas.some((l) => l.cantidad > l.devuelto) && (
          <Devolver id={v.id} credito={v.condicion === "credito"} medioOriginal={d.pagos.length ? [...d.pagos].sort((a, b) => b.valor - a.valor)[0].medio : null} lineas={d.lineas.filter((l) => l.cantidad > l.devuelto).map((l) => ({ producto_id: l.producto_id, presentacion: l.presentacion, descripcion: l.descripcion, disponible: l.cantidad - l.devuelto, unitario: l.total / l.cantidad }))} />
        )}
        {v.estado === "cerrada" && Number(v.devuelto) === 0 && puede.anular(s.rol) && <Anular id={v.id} emitido={d.doc?.estado === "aceptado" || d.doc?.estado === "enviando"} />}
      </section>
    </main>
  );
}
