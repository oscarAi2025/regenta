import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { lineasConteo } from "@/lib/conteos";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { pesosConSigno as pesos } from "@/lib/ajustes";
import { Contar } from "./Contar";
import { AnularConteo } from "./Anular";

export const metadata = { title: "Conteo físico" };

export default async function Conteo({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/inventario?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const costos = puede.verCostos(s.rol);
  const d = await comoUsuario(s, async (c) => {
    const k = (await c.query(`select k.*, aj.numero ajuste_numero, to_char(k.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') inicio,
        to_char(k.cerrado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fin
      from conteos k left join ajustes aj on aj.id = k.ajuste_id where k.id = $1 and k.empresa_id = $2`, [id, s.empresa])).rows[0];
    return k ? { k, lineas: await lineasConteo(c, id, costos) } : null;
  });
  if (!d) notFound();
  const { k, lineas } = d;
  const alcance = k.alcance === "todo" ? "Todo el inventario" : `${k.alcance === "laboratorio" ? "Laboratorio" : "Categoría"}: ${k.filtro}`;
  if (k.estado === "abierto") {
    return (
      <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
        <Cabecera titulo={`Conteo N.º ${k.numero}${k.a_ciegas ? " · a ciegas" : ""}`} sub={`${alcance} · empezó ${k.inicio}. Puedes contar desde varios celulares a la vez.`}>
          {(!k.a_ciegas || costos) && <Link href={`/inventario/conteos/${id}/informe`} className="btn-borde">{k.a_ciegas ? "Ver diferencias (informe)" : "Informe"}</Link>}
          <Link href="/inventario/conteos" className="btn-borde">Conteos</Link>
          {(s.rol === "dueno" || s.rol === "admin") && <AnularConteo id={id} numero={k.numero} />}
        </Cabecera>
        <p className="text-sm text-muted max-w-3xl">Mientras cuentas puedes seguir vendiendo: cada lote se compara con las existencias del momento en que lo cuentas, así lo vendido después no aparece como faltante.</p>
        <Contar conteo={{ id, numero: k.numero }} inicial={lineas} verCosto={costos} ciego={!!k.a_ciegas} />
      </main>
    );
  }
  if (k.estado === "anulado") {
    return (
      <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
        <Cabecera titulo={`Conteo N.º ${k.numero} · anulado`} sub={`${alcance} · ${k.inicio} → ${k.fin}. Un conteo anulado no cambió ninguna existencia.`}>
          <Link href="/inventario/conteos" className="btn-borde">Conteos</Link>
        </Cabecera>
        <p className="text-[15px]"><b>Motivo de la anulación:</b> {k.motivo_anulacion}</p>
        <p className="text-sm text-muted">Se habían contado {lineas.filter((l) => l.contado !== null).length.toLocaleString("es-CO")} de {lineas.length.toLocaleString("es-CO")} lotes.</p>
      </main>
    );
  }
  const dif = lineas.filter((l) => l.contado !== null && l.contado !== l.sistema);
  const valor = costos ? dif.reduce((a, l) => a + (l.contado! - l.sistema) * (l.costo ?? 0), 0) : null;
  const r = k.resumen ?? {};
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo={`Conteo N.º ${k.numero} · cerrado`} sub={`${alcance} · ${k.inicio} → ${k.fin}. Un conteo cerrado ya no se modifica.`}>
        <Link href={`/inventario/conteos/${id}/informe`} className="btn-primario">Informe para imprimir</Link>
        <Link href="/inventario/conteos" className="btn-borde">Conteos</Link>
      </Cabecera>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Dato titulo="Lotes contados" valor={`${Number(r.contados ?? 0).toLocaleString("es-CO")} de ${Number(r.lotes ?? lineas.length).toLocaleString("es-CO")}`} nota={k.sin_contar_en_cero && r.sin_contar ? "Los no contados quedaron en cero" : undefined} />
        <Dato titulo="Con diferencia" valor={Number(r.con_diferencia ?? 0).toLocaleString("es-CO")} tono={r.con_diferencia ? "aviso" : "cruz"} />
        <Dato titulo="Faltaron / sobraron" valor={`${Number(r.faltantes ?? 0).toLocaleString("es-CO")} / ${Number(r.sobrantes ?? 0).toLocaleString("es-CO")}`} nota="unidades" />
        {valor !== null ? <Dato titulo="Diferencia a costo" valor={pesos(valor)} tono={valor < 0 ? "alerta" : valor > 0 ? "aviso" : "cruz"} /> : <Dato titulo="Ajuste" valor={k.ajuste_numero ? `N.º ${k.ajuste_numero}` : "Sin ajuste"} />}
      </div>
      {k.ajuste_id ? <p className="text-[15px]">Las existencias quedaron iguales a lo contado con el <Link href={`/inventario/actas/${k.ajuste_id}`} className="font-semibold text-cruz underline">ajuste N.º {k.ajuste_numero}</Link> («Diferencia de conteo»).</p>
        : <p className="text-[15px]">Todo cuadró: no hizo falta ningún ajuste.</p>}
      {k.observaciones && <p className="text-[15px]"><b>Observaciones:</b> {k.observaciones}</p>}
      <section aria-labelledby="dif-t" className="grid gap-3">
        <h2 id="dif-t" className="titulo text-2xl">Diferencias por lote</h2>
        {dif.length === 0 ? <p className="tarjeta p-8 text-center text-muted">Ningún lote contado tuvo diferencia.</p> : (
          <div className="tarjeta overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-left text-muted border-b border-line"><tr>
                <th className="px-4 py-3 font-semibold">Producto</th><th className="px-4 py-3 font-semibold">Lote</th><th className="px-4 py-3 font-semibold text-right">Sistema</th>
                <th className="px-4 py-3 font-semibold text-right">Contado</th><th className="px-4 py-3 font-semibold text-right">Diferencia</th>{costos && <th className="px-4 py-3 font-semibold text-right">A costo</th>}
              </tr></thead>
              <tbody className="divide-y divide-line">
                {dif.map((l) => { const x = l.contado! - l.sistema; return (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5"><span className="font-semibold">{l.nombre}</span><span className="block text-muted">{l.laboratorio ?? "Genérico"}</span></td>
                    <td className="px-4 py-2.5 num">{l.lote}</td><td className="px-4 py-2.5 num text-right">{l.sistema}</td><td className="px-4 py-2.5 num text-right">{l.contado}</td>
                    <td className={`px-4 py-2.5 num text-right font-semibold ${x < 0 ? "text-alerta" : "text-aviso"}`}>{x > 0 ? "+" : "−"}{Math.abs(x)}</td>
                    {costos && <td className="px-4 py-2.5 num text-right">{l.costo !== null ? pesos(x * l.costo) : "—"}</td>}
                  </tr>); })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
