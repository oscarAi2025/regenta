import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { rango } from "@/lib/reportes";
import { datosLibro, TIPO_LIBRO } from "@/lib/libro-control";
import { Imprimir } from "./Imprimir";

// Informe imprimible del libro de control especial (hoja horizontal): saldos del periodo y cada dispensación o reintegro.
export const metadata: Metadata = { title: "Informe de control especial", robots: { index: false, follow: false } };

const fecha = (f: string) => f.split("-").reverse().join("/");

export default async function Informe({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; producto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso");
  const sp = await searchParams;
  const r = rango(sp.desde, sp.hasta);
  const producto = sp.producto && /^[0-9a-f-]{36}$/i.test(sp.producto) ? sp.producto : null;
  const { d, e } = await comoUsuario(s, async (c) => ({
    d: await datosLibro(c, s.empresa, r, producto),
    e: (await c.query(`select coalesce(e.nombre_comercial, e.razon_social) nombre, e.razon_social, e.nit, e.dv, e.direccion, e.ciudad,
        (select nombre from sedes where empresa_id = e.id order by creado limit 1) sede from empresas e where e.id = $1`, [s.empresa])).rows[0],
  }));
  const generado = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "long", timeStyle: "short" });
  const nombreElegido = d.productos.find((p) => p.id === d.elegido)?.nombre;
  const th = "py-1.5 px-1.5 text-left font-semibold border-b-2 border-ink";
  const td = "py-1.5 px-1.5 align-top border-b border-line";
  return (
    <main className="informe max-w-[1200px] mx-auto p-4 sm:p-10 print:p-0 bg-white text-ink grid gap-5 text-[13px]">
      <style>{`@page { size: A4 landscape; margin: 12mm; } @media print { html, body { background: #fff; } .informe { font-size: 10.5px; } tr { break-inside: avoid; } }`}</style>
      <header className="flex flex-wrap justify-between gap-4 border-b-2 border-ink pb-3">
        <div>
          <p className="titulo text-xl">{e.nombre}</p>
          <p>{e.razon_social} · NIT {e.nit}{e.dv ? `-${e.dv}` : ""}</p>
          <p>{[e.direccion, e.ciudad].filter(Boolean).join(", ")}{e.sede ? ` · Sede ${e.sede}` : ""}</p>
        </div>
        <div className="text-right">
          <h1 className="titulo text-2xl">Libro de control especial</h1>
          <p className="font-semibold">Del {fecha(r.desde)} al {fecha(r.hasta)}</p>
          <p>{nombreElegido ?? "Todos los productos de control especial"}</p>
        </div>
      </header>

      <section aria-labelledby="inf-saldos">
        <h2 id="inf-saldos" className="titulo text-lg mb-1">Saldo por producto (unidades)</h2>
        {/* En el celular la tabla se desplaza dentro de su recuadro (la página no se corre de lado); impresa, en A4 horizontal. */}
        <div className="overflow-x-auto print:overflow-visible"><table className="w-full num min-w-[640px] print:min-w-0">
          <thead><tr><th className={th}>Producto</th><th className={`${th} text-right`}>Saldo inicial</th><th className={`${th} text-right`}>Entradas</th><th className={`${th} text-right`}>Salidas</th>
            <th className={`${th} text-right`}>Saldo final</th><th className={`${th} text-right`}>Dispensado con fórmula</th><th className={`${th} text-right`}>Reintegrado</th><th className={`${th} text-right`}>Conteo físico</th></tr></thead>
          <tbody>{d.saldos.map((x) => (
            <tr key={x.id}><td className={`${td} font-sans`}>{x.nombre}</td><td className={`${td} text-right`}>{x.inicial}</td><td className={`${td} text-right`}>{x.entradas}</td><td className={`${td} text-right`}>{x.salidas}</td>
              <td className={`${td} text-right font-semibold`}>{x.final}</td><td className={`${td} text-right`}>{x.dispensado}</td><td className={`${td} text-right`}>{x.reintegrado}</td><td className={`${td} w-28`} /></tr>
          ))}
          {d.saldos.length === 0 && <tr><td colSpan={8} className={td}>No hay productos de control especial.</td></tr>}</tbody>
        </table></div>
      </section>

      <section aria-labelledby="inf-libro">
        <h2 id="inf-libro" className="titulo text-lg mb-1">Dispensaciones y reintegros ({d.filas.length})</h2>
        <div className="overflow-x-auto print:overflow-visible"><table className="w-full min-w-[900px] print:min-w-0">
          <thead><tr><th className={th}>Fecha</th><th className={th}>Movimiento</th><th className={th}>Producto</th><th className={th}>Lote</th><th className={`${th} text-right`}>Cant.</th>
            <th className={th}>Paciente</th><th className={th}>Médico · registro</th><th className={th}>Fórmula</th><th className={th}>Venta</th><th className={th}>Usuario</th></tr></thead>
          <tbody>{d.filas.map((f) => (
            <tr key={f.id}>
              <td className={`${td} num whitespace-nowrap`}>{fecha(f.fecha.slice(0, 10))} {f.fecha.slice(11)}</td>
              <td className={td}>{TIPO_LIBRO[f.tipo]}{f.motivo ? <span className="block text-muted">{f.motivo}</span> : null}</td>
              <td className={td}>{f.producto}</td>
              <td className={`${td} num`}>{f.lote ?? "—"}</td>
              <td className={`${td} num text-right font-semibold`}>{f.tipo === "reintegro" ? `+${f.reintegro}` : `−${f.salida}`}</td>
              <td className={td}>{f.paciente_nombre}<span className="block num">{f.paciente_tipo_doc} {f.paciente_doc}</span></td>
              <td className={td}>{f.medico_nombre}<span className="block">Reg. {f.medico_registro}</span></td>
              <td className={`${td} num`}>N.º {f.formula_numero}<span className="block">{fecha(f.formula_fecha)}</span></td>
              <td className={`${td} num`}>{f.venta}</td>
              <td className={td}>{f.usuario || "—"}</td>
            </tr>
          ))}
          {d.filas.length === 0 && <tr><td colSpan={10} className={td}>No hay dispensaciones en este periodo.</td></tr>}</tbody>
        </table></div>
      </section>

      <footer className="grid sm:grid-cols-2 print:grid-cols-2 gap-10 pt-10">
        <p className="border-t border-ink pt-1.5">Elaboró (nombre y firma)</p>
        <p className="border-t border-ink pt-1.5">Revisó: director técnico o regente (nombre y firma)</p>
      </footer>
      <p className="text-muted">Generado en Regenta el {generado} por {s.nombre.split(" (")[0]}. Los registros del libro no se editan ni se borran: una anulación o devolución aparece como reintegro.</p>
      <Imprimir />
    </main>
  );
}
