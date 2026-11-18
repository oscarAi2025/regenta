import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";

export const metadata = { title: "Contingencias DIAN" };

const CAUSA: Record<string, string> = { sin_internet: "Sin internet en la droguería", proveedor: "Proveedor tecnológico sin respuesta", dian: "DIAN sin respuesta" };
const hora = (d: string | Date | null) => d ? new Date(d).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" }) : "sigue abierta";

/** Bitácora de inconvenientes tecnológicos (Res. DIAN 165/2023 art. 37): soporte de que la droguería expidió en contingencia
 *  y transmitió dentro del plazo. Se conserva como cualquier soporte contable. */
export default async function Contingencias() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.anular(s.rol)) redirect("/inicio?aviso=permiso"); // dueño y administrador
  const d = await comoUsuario(s, async (c) => ({
    incidencias: (await c.query(`select i.causa, i.inicio, i.fin, i.detalle, i.ventas, k.nombre caja from incidencias_dian i left join cajas k on k.id = i.caja_id
      where i.empresa_id = $1 order by i.inicio desc limit 200`, [s.empresa])).rows,
    tiquetes: (await c.query(`select n.prefijo || n.numero doc, v.creado, v.total::float, d.estado, d.actualizado, v.id venta
      from contingencia_numeros n join ventas v on v.id = n.venta_id left join documentos_dian d on d.venta_id = v.id and d.tipo = 'pos'
      where n.empresa_id = $1 order by v.creado desc limit 200`, [s.empresa])).rows,
  }));
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Contingencias DIAN" sub="Inconvenientes tecnológicos y tiquetes expedidos en contingencia (Res. DIAN 165 de 2023, art. 37)">
        <Link href="/documentos" className="btn-borde">Volver a documentos</Link>
      </Cabecera>
      <section className="tarjeta p-5 grid gap-3" aria-labelledby="t-inc">
        <h2 id="t-inc" className="titulo text-xl">Inconvenientes registrados</h2>
        <p className="text-sm text-muted">Regenta los anota solo: cuando la caja vende sin internet y cuando el proveedor o la DIAN no responden. Es el soporte que pide la norma; consérvalo.</p>
        {d.incidencias.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-muted"><th className="py-2 pr-3">Causa</th><th className="py-2 pr-3">Desde</th><th className="py-2 pr-3">Hasta</th><th className="py-2 pr-3">Caja</th><th className="py-2 pr-3 text-right">Ventas</th><th className="py-2">Detalle</th></tr></thead>
            <tbody className="divide-y divide-line">{d.incidencias.map((x, i) => (
              <tr key={i}><td className="py-2 pr-3 font-semibold">{CAUSA[x.causa] ?? x.causa}</td><td className="py-2 pr-3 whitespace-nowrap">{hora(x.inicio)}</td><td className="py-2 pr-3 whitespace-nowrap">{hora(x.fin)}</td>
                <td className="py-2 pr-3">{x.caja ?? "—"}</td><td className="py-2 pr-3 text-right num">{x.causa === "sin_internet" ? x.ventas : "—"}</td><td className="py-2 text-muted">{x.detalle}</td></tr>))}</tbody>
          </table></div>
        ) : <p className="text-muted">Sin inconvenientes registrados.</p>}
      </section>
      <section className="tarjeta p-5 grid gap-3" aria-labelledby="t-tiq">
        <h2 id="t-tiq" className="titulo text-xl">Tiquetes expedidos en contingencia</h2>
        {d.tiquetes.length ? (
          <ul className="divide-y divide-line text-sm">{d.tiquetes.map((t) => (
            <li key={t.doc} className="py-2 flex flex-wrap justify-between gap-2"><Link href={`/ventas/${t.venta}`} className="font-semibold underline">{t.doc}</Link>
              <span>{hora(t.creado)}</span><span className={t.estado === "aceptado" ? "text-cruz" : t.estado === "rechazado" ? "text-alerta" : "text-aviso"}>{t.estado === "aceptado" ? `Transmitido · ${hora(t.actualizado)}` : t.estado ?? "pendiente"}</span></li>))}</ul>
        ) : <p className="text-muted">Ningún tiquete se ha expedido en contingencia.</p>}
      </section>
    </main>
  );
}
