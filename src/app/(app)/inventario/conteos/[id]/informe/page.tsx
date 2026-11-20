import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { CAUSAS, justificaciones, lineasConteo } from "@/lib/conteos";
import { Justificar } from "./Justificar";
import { pesosConSigno } from "@/lib/ajustes";
import { Imprimible } from "@/components/app/Imprimible";

export const metadata = { title: "Informe de conteo" };

const fecha = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

/** Informe del conteo físico para imprimir y firmar: resumen y diferencias por lote (con ?todo=1, todos los lotes). */
export default async function Informe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ todo?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/inventario?aviso=permiso");
  const { id } = await params;
  const todo = (await searchParams).todo === "1";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const costos = puede.verCostos(s.rol);
  const d = await comoUsuario(s, async (c) => {
    const k = (await c.query(`select k.*, aj.numero ajuste_numero, to_char(k.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') inicio,
        to_char(k.cerrado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fin, e.razon_social, e.nombre_comercial, e.nit, e.dv, e.direccion, e.ciudad,
        sd.nombre sede, mi.nombre responsable, mc.nombre cierra
      from conteos k join empresas e on e.id = k.empresa_id join sedes sd on sd.id = k.sede_id left join ajustes aj on aj.id = k.ajuste_id
      left join miembros mi on mi.empresa_id = k.empresa_id and mi.user_id = k.usuario_id left join miembros mc on mc.empresa_id = k.empresa_id and mc.user_id = k.cierra_usuario
      where k.id = $1 and k.empresa_id = $2`, [id, s.empresa])).rows[0];
    return k ? { k, lineas: await lineasConteo(c, id, costos), just: await justificaciones(c, id) } : null;
  });
  if (!d) notFound();
  const { k, lineas, just } = d;
  // Conteo a ciegas abierto: las diferencias solo las ve la gerencia (quien cuenta vuelve a la pantalla de contar).
  if (k.a_ciegas && k.estado === "abierto" && !costos) redirect(`/inventario/conteos/${id}`);
  const contadas = lineas.filter((l) => l.contado !== null);
  const dif = contadas.filter((l) => l.contado !== l.sistema);
  const filas = todo ? lineas : dif;
  const suma = (f: (l: (typeof lineas)[number]) => number) => dif.reduce((a, l) => a + f(l), 0);
  const faltan = suma((l) => Math.max(0, l.sistema - l.contado!)), sobran = suma((l) => Math.max(0, l.contado! - l.sistema));
  const valor = costos ? suma((l) => (l.contado! - l.sistema) * (l.costo ?? 0)) : null;
  // Explicación de las diferencias: cuántas tienen causa, cuánto falta por explicar y el resumen por causa.
  const explicadas = dif.filter((l) => just.has(l.id)), pendientes = dif.filter((l) => !just.has(l.id));
  const porCausa = [...explicadas.reduce((m, l) => { const c = just.get(l.id)!.causa; const x = m.get(c) ?? { lotes: 0, und: 0, valor: 0 };
    x.lotes++; x.und += l.contado! - l.sistema; x.valor += (l.contado! - l.sistema) * (l.costo ?? 0); m.set(c, x); return m; }, new Map<string, { lotes: number; und: number; valor: number }>())]
    .sort((a, b) => Math.abs(b[1].valor) - Math.abs(a[1].valor) || b[1].lotes - a[1].lotes);
  const valorPendiente = costos ? pendientes.reduce((a, l) => a + (l.contado! - l.sistema) * (l.costo ?? 0), 0) : null;
  const puedeExplicar = k.estado !== "anulado";
  const alcance = k.alcance === "todo" ? "Todo el inventario" : `${k.alcance === "laboratorio" ? "Laboratorio" : "Categoría"}: ${k.filtro}`;
  const nombre = (x: string | null) => String(x ?? "").split(" (")[0] || "—";
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-4">
      <Imprimible volver={{ href: `/inventario/conteos/${id}`, texto: "Volver al conteo" }} etiqueta={`Informe del conteo N.º ${k.numero}`}>
        <header className="flex flex-wrap justify-between gap-4 border-b-2 border-ink pb-4">
          <div>
            <p className="titulo text-2xl leading-tight">{k.nombre_comercial || k.razon_social}</p>
            <p className="text-sm">{k.razon_social}<br />NIT {k.nit}{k.dv ? `-${k.dv}` : ""}{k.direccion ? ` · ${k.direccion}` : ""}{k.ciudad ? `, ${k.ciudad}` : ""}</p>
          </div>
          <div className="text-right">
            <h1 className="titulo text-xl leading-tight">Informe de conteo físico</h1>
            <p className="num text-lg font-semibold">N.º {String(k.numero).padStart(4, "0")}</p>
            <p className={`text-sm font-semibold ${k.estado === "abierto" ? "text-aviso" : ""}`}>{k.estado === "abierto" ? "Borrador: conteo abierto" : k.estado === "anulado" ? "Anulado: no cambió el inventario" : "Cerrado"}</p>
          </div>
        </header>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 py-4 text-[15px]">
          <div><dt className="text-sm text-muted">Alcance</dt><dd className="font-semibold">{alcance}</dd></div>
          <div><dt className="text-sm text-muted">Sede</dt><dd className="font-semibold">{k.sede}</dd></div>
          <div><dt className="text-sm text-muted">Inicio</dt><dd className="font-semibold num">{k.inicio}</dd></div>
          <div><dt className="text-sm text-muted">Cierre</dt><dd className="font-semibold num">{k.fin ?? "—"}</dd></div>
          <div><dt className="text-sm text-muted">Lotes contados</dt><dd className="font-semibold num">{contadas.length.toLocaleString("es-CO")} de {lineas.length.toLocaleString("es-CO")}</dd></div>
          <div><dt className="text-sm text-muted">Con diferencia</dt><dd className="font-semibold num">{dif.length.toLocaleString("es-CO")}</dd></div>
          <div><dt className="text-sm text-muted">Faltantes / sobrantes</dt><dd className="font-semibold num">{faltan.toLocaleString("es-CO")} / {sobran.toLocaleString("es-CO")} und</dd></div>
          {valor !== null ? <div><dt className="text-sm text-muted">Diferencia a costo</dt><dd className="font-semibold num">{pesosConSigno(valor)}</dd></div>
            : <div><dt className="text-sm text-muted">Ajuste</dt><dd className="font-semibold">{k.ajuste_numero ? `N.º ${k.ajuste_numero}` : "—"}</dd></div>}
        </dl>
        <p className="text-[15px] pb-3">
          {k.estado === "abierto" ? "Cada lote contado se compara con las existencias del momento en que se contó (los demás, con las de ahora); el conteo aún no ajusta el inventario."
            : k.estado === "anulado" ? `Conteo anulado: no cambió ninguna existencia. Motivo: ${k.motivo_anulacion ?? ""}.`
            : k.ajuste_numero ? `Al cerrar, las existencias quedaron iguales a lo contado con el ajuste N.º ${k.ajuste_numero} («Diferencia de conteo»).` : "Al cerrar, todo cuadró: no hizo falta ajuste."}
          {k.sin_contar_en_cero ? " Los lotes que no se contaron quedaron en cero." : lineas.length > contadas.length && k.estado === "cerrado" ? ` ${lineas.length - contadas.length} lotes no se contaron y quedaron como estaban.` : ""}
        </p>
        {k.observaciones && <p className="text-[15px] pb-3"><b>Observaciones:</b> {k.observaciones}</p>}
        {dif.length > 0 && (
          <section aria-labelledby="explicacion" className="pb-4">
            <h2 id="explicacion" className="titulo text-lg">Explicación de las diferencias</h2>
            <p className={`text-[15px] ${pendientes.length ? "text-aviso font-semibold" : "text-cruz font-semibold"}`}>
              {pendientes.length === 0 ? `Las ${dif.length} diferencias están explicadas.`
                : `${explicadas.length} de ${dif.length} explicadas · faltan ${pendientes.length}${valorPendiente !== null ? ` (${pesosConSigno(valorPendiente)} a costo)` : ""}.`}
            </p>
            {porCausa.length > 0 && (
              <table className="mt-2 w-full max-w-[640px] text-sm border-collapse" aria-label="Diferencias por causa">
                <thead><tr className="text-left border-b border-ink"><th className="py-1 pr-2 font-semibold">Causa</th><th className="py-1 pr-2 font-semibold text-right">Lotes</th>
                  <th className="py-1 pr-2 font-semibold text-right">Unidades</th>{costos && <th className="py-1 font-semibold text-right">A costo</th>}</tr></thead>
                <tbody>{porCausa.map(([c, x]) => (
                  <tr key={c} className="border-b border-line"><td className="py-1 pr-2">{CAUSAS[c] ?? c}</td><td className="py-1 pr-2 num text-right">{x.lotes}</td>
                    <td className="py-1 pr-2 num text-right">{x.und > 0 ? "+" : x.und < 0 ? "−" : ""}{Math.abs(x.und).toLocaleString("es-CO")}</td>{costos && <td className="py-1 num text-right">{pesosConSigno(x.valor)}</td>}</tr>))}</tbody>
              </table>
            )}
          </section>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-2 no-imprimir pb-2">
          <a href={todo ? "?" : "?todo=1"} className="text-sm font-semibold text-cruz underline">{todo ? "Ver solo los lotes con diferencia" : "Incluir todos los lotes del conteo"}</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px] border-collapse">
            <thead><tr className="text-left border-y-2 border-ink">
              <th className="py-2 pr-2 font-semibold">Producto</th><th className="py-2 pr-2 font-semibold">Lote</th><th className="py-2 pr-2 font-semibold">Vence</th>
              <th className="py-2 pr-2 font-semibold text-right">Sistema</th><th className="py-2 pr-2 font-semibold text-right">Contado</th><th className="py-2 pr-2 font-semibold text-right">Diferencia</th>
              {costos && <th className="py-2 pr-2 font-semibold text-right">A costo</th>}
              <th className="py-2 font-semibold">Explicación</th>
            </tr></thead>
            <tbody>
              {filas.map((l) => { const x = l.contado === null ? null : l.contado - l.sistema; return (
                <tr key={l.id} className="border-b border-line align-top">
                  <td className="py-1.5 pr-2"><span className="font-semibold">{l.nombre}</span><span className="block text-xs text-muted">{l.laboratorio ?? "Sin laboratorio"}</span></td>
                  <td className="py-1.5 pr-2 num">{l.lote}</td><td className="py-1.5 pr-2 num">{fecha(l.vence)}</td>
                  <td className="py-1.5 pr-2 num text-right">{l.sistema}</td><td className="py-1.5 pr-2 num text-right">{l.contado ?? "—"}</td>
                  <td className="py-1.5 pr-2 num text-right font-semibold">{x === null ? "Sin contar" : x === 0 ? "0" : `${x > 0 ? "+" : "−"}${Math.abs(x)}`}</td>
                  {costos && <td className="py-1.5 pr-2 num text-right">{x && l.costo !== null ? pesosConSigno(x * l.costo) : "—"}</td>}
                  <td className="py-1.5 min-w-[200px]">{x ? (() => { const j = just.get(l.id); return <>
                    {j ? <span className="block"><b>{CAUSAS[j.causa] ?? j.causa}.</b> {j.detalle}{j.documento ? ` Soporte: ${j.documento}.` : ""}
                      <span className="block text-xs text-muted">{String(j.usuario ?? "").split(" (")[0]} · {j.fecha}{j.anteriores ? ` · ${j.anteriores} explicación${j.anteriores === 1 ? "" : "es"} anterior${j.anteriores === 1 ? "" : "es"}` : ""}</span></span>
                      : <span className="font-semibold text-aviso">Sin explicar</span>}
                    {puedeExplicar && <Justificar conteoId={id} lineaId={l.id} causas={CAUSAS} hay={!!j} />}</>; })() : null}</td>
                </tr>); })}
              {filas.length === 0 && <tr><td colSpan={costos ? 8 : 7} className="py-6 text-center text-muted">{contadas.length ? "Ningún lote contado tiene diferencia." : "Todavía no hay lotes contados."}</td></tr>}
            </tbody>
          </table>
        </div>
        <section className="grid gap-6 mt-10 sm:grid-cols-2" aria-label="Firmas">
          {[["Responsable del conteo", nombre(k.cierra ?? k.responsable)], ["Director(a) técnico(a) o regente de farmacia", ""]].map(([t, n]) => (
            <div key={t} className="firma pt-12"><div className="border-t border-ink pt-1.5 text-sm"><p className="font-semibold">{t}</p><p>Nombre: {n || "______________________"}</p><p>C.C. / T.P.: __________________</p></div></div>
          ))}
        </section>
        <p className="text-xs text-muted mt-8">Generado en Regenta el {new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" })}</p>
      </Imprimible>
    </main>
  );
}
