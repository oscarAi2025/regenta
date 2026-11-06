import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { lineasConteo } from "@/lib/conteos";
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
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const costos = puede.verCostos(s.rol);
  const d = await comoUsuario(s, async (c) => {
    const k = (await c.query(`select k.*, aj.numero ajuste_numero, to_char(k.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') inicio,
        to_char(k.cerrado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fin, e.razon_social, e.nombre_comercial, e.nit, e.dv, e.direccion, e.ciudad,
        sd.nombre sede, mi.nombre responsable, mc.nombre cierra
      from conteos k join empresas e on e.id = k.empresa_id join sedes sd on sd.id = k.sede_id left join ajustes aj on aj.id = k.ajuste_id
      left join miembros mi on mi.empresa_id = k.empresa_id and mi.user_id = k.usuario_id left join miembros mc on mc.empresa_id = k.empresa_id and mc.user_id = k.cierra_usuario
      where k.id = $1 and k.empresa_id = $2`, [id, s.empresa])).rows[0];
    return k ? { k, lineas: await lineasConteo(c, id, costos) } : null;
  });
  if (!d) notFound();
  const { k, lineas } = d;
  const contadas = lineas.filter((l) => l.contado !== null);
  const dif = contadas.filter((l) => l.contado !== l.sistema);
  const filas = todo ? lineas : dif;
  const suma = (f: (l: (typeof lineas)[number]) => number) => dif.reduce((a, l) => a + f(l), 0);
  const faltan = suma((l) => Math.max(0, l.sistema - l.contado!)), sobran = suma((l) => Math.max(0, l.contado! - l.sistema));
  const valor = costos ? suma((l) => (l.contado! - l.sistema) * (l.costo ?? 0)) : null;
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
            <p className={`text-sm font-semibold ${k.estado === "abierto" ? "text-aviso" : ""}`}>{k.estado === "abierto" ? "Borrador: conteo abierto" : "Cerrado"}</p>
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
          {k.estado === "abierto" ? "Las diferencias se calculan contra las existencias de este momento; el conteo aún no ajusta el inventario."
            : k.ajuste_numero ? `Al cerrar, las existencias quedaron iguales a lo contado con el ajuste N.º ${k.ajuste_numero} («Diferencia de conteo»).` : "Al cerrar, todo cuadró: no hizo falta ajuste."}
          {k.sin_contar_en_cero ? " Los lotes que no se contaron quedaron en cero." : lineas.length > contadas.length && k.estado === "cerrado" ? ` ${lineas.length - contadas.length} lotes no se contaron y quedaron como estaban.` : ""}
        </p>
        {k.observaciones && <p className="text-[15px] pb-3"><b>Observaciones:</b> {k.observaciones}</p>}
        <div className="flex flex-wrap items-baseline justify-between gap-2 no-imprimir pb-2">
          <a href={todo ? "?" : "?todo=1"} className="text-sm font-semibold text-cruz underline">{todo ? "Ver solo los lotes con diferencia" : "Incluir todos los lotes del conteo"}</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px] border-collapse">
            <thead><tr className="text-left border-y-2 border-ink">
              <th className="py-2 pr-2 font-semibold">Producto</th><th className="py-2 pr-2 font-semibold">Lote</th><th className="py-2 pr-2 font-semibold">Vence</th>
              <th className="py-2 pr-2 font-semibold text-right">Sistema</th><th className="py-2 pr-2 font-semibold text-right">Contado</th><th className="py-2 pr-2 font-semibold text-right">Diferencia</th>
              {costos && <th className="py-2 font-semibold text-right">A costo</th>}
            </tr></thead>
            <tbody>
              {filas.map((l) => { const x = l.contado === null ? null : l.contado - l.sistema; return (
                <tr key={l.id} className="border-b border-line align-top">
                  <td className="py-1.5 pr-2"><span className="font-semibold">{l.nombre}</span><span className="block text-xs text-muted">{l.laboratorio ?? "Genérico"}</span></td>
                  <td className="py-1.5 pr-2 num">{l.lote}</td><td className="py-1.5 pr-2 num">{fecha(l.vence)}</td>
                  <td className="py-1.5 pr-2 num text-right">{l.sistema}</td><td className="py-1.5 pr-2 num text-right">{l.contado ?? "—"}</td>
                  <td className="py-1.5 pr-2 num text-right font-semibold">{x === null ? "Sin contar" : x === 0 ? "0" : `${x > 0 ? "+" : "−"}${Math.abs(x)}`}</td>
                  {costos && <td className="py-1.5 num text-right">{x && l.costo !== null ? pesosConSigno(x * l.costo) : "—"}</td>}
                </tr>); })}
              {filas.length === 0 && <tr><td colSpan={costos ? 7 : 6} className="py-6 text-center text-muted">{contadas.length ? "Ningún lote contado tiene diferencia." : "Todavía no hay lotes contados."}</td></tr>}
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
