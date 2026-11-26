import Link from "next/link";
import { PLANES, NOTA_PRECIOS, SOCIO } from "@/lib/planes";
import type { Pagina } from "@/content/paginas";

/** Lo que una droguería debe exigirle a su software y cómo lo resuelve Regenta. Solo funciones que existen hoy. */
const REQUISITOS: [string, string, string][] = [
  ["POS electrónico y factura electrónica", "Los dos documentos desde la misma caja, con tu resolución. Certificado digital y habilitación ante la DIAN incluidos.", "/funciones/facturacion-electronica"],
  ["Venta por caja y por unidad", "Un solo producto con precio por caja y por unidad, sin descuadrar el inventario.", "/funciones/caja-pos"],
  ["Lote y vencimiento en cada venta", "La caja saca primero el lote que vence antes y no deja vender un lote vencido.", "/funciones/control-de-vencimientos"],
  ["Alertas sanitarias del INVIMA", "Cruzadas con tus lotes: sabes si lo que tienes en la estantería está afectado.", "/funciones/alertas-invima"],
  ["Control especial", "Libro de control especial e informe mensual (Anexo 13) en los planes Pro y Cadena.", "/precios"],
  ["Pedido a proveedores", "Pedido sugerido calculado con tus ventas reales, y compras que entran por lote.", "/funciones/pedido-sugerido"],
  ["Crédito y cartera", "Ventas a crédito a 15, 30, 45, 60 o 90 días con la cartera al día.", "/funciones/cartera-y-credito"],
  ["Inventario que cuadra", "Conteos físicos guardados con sus diferencias, ajustes con motivo y descarga del inventario a Excel.", "/software/inventario-farmacia"],
  ["Un asistente que conoce tu negocio", "Regenta IA responde con tus datos: qué pedir, qué se vence y cuánto vendiste.", "/funciones/regenta-ia"],
];

const pesos = (n: number) => "$" + n.toLocaleString("es-CO");

/** Bloques comerciales de las páginas /software: requisitos, precio y prueba de uso real. */
export function BloquesSoftware({ p }: { p: Pagina }) {
  const socio = SOCIO.escalones[0];
  return (
    <>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14">
        <h2 className="font-cond text-[34px] leading-none" style={{ fontWeight: 700 }}>Lo que tu software de droguería debe hacer</h2>
        <p className="mt-3 text-muted max-w-[46em]">Antes de elegir, compara con esta lista. Es lo que exige el día a día de una droguería en Colombia y lo que ya hace Regenta.</p>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-left text-[15px] block sm:table">
            <thead className="bg-surface hidden sm:table-header-group"><tr><th scope="col" className="p-4 font-semibold w-[34%]">Qué necesita tu droguería</th><th scope="col" className="p-4 font-semibold">Cómo lo hace Regenta</th></tr></thead>
            <tbody className="block sm:table-row-group">
              {REQUISITOS.map(([q, r, h]) => (
                <tr key={q} className="block sm:table-row border-t first:border-t-0 sm:first:border-t border-line align-top">
                  <th scope="row" className="block sm:table-cell px-4 pt-4 pb-1 sm:p-4 font-semibold">{q}</th>
                  <td className="block sm:table-cell px-4 pb-4 sm:p-4 text-ink/85">{r} <Link href={h} className="text-teal-700 underline underline-offset-4 whitespace-nowrap">Ver cómo</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14">
        <h2 className="font-cond text-[34px] leading-none" style={{ fontWeight: 700 }}>¿Cuánto cuesta Regenta?</h2>
        <p className="mt-3 text-muted max-w-[46em]">{NOTA_PRECIOS}</p>
        <ul className="mt-6 grid md:grid-cols-3 gap-4">
          {PLANES.map((pl) => (
            <li key={pl.id} className={`tarjeta p-5 ${pl.destacado ? "border-2 border-teal-600" : ""}`}>
              <p className="font-cond text-2xl" style={{ fontWeight: 700 }}>{pl.nombre}</p>
              <p className="text-muted text-sm">{pl.para}</p>
              <p className="mt-3 font-cond text-[34px] leading-none num" style={{ fontWeight: 700 }}>{pl.precio ? <>{pesos(pl.precio)}<span className="text-base text-muted font-normal"> /mes</span></> : "A la medida"}</p>
              <ul className="mt-3 grid gap-1 text-[14px] text-ink/80">{pl.incluye.slice(0, 3).map((x) => <li key={x}>· {x}</li>)}</ul>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[15px]"><b>{SOCIO.nombre}:</b> {SOCIO.resumen} Desde {pesos(socio.desde)} de compras al mes, {socio.etiqueta.toLowerCase()}. <Link href="/precios" className="text-teal-700 underline underline-offset-4">Ver todos los planes</Link></p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14">
        <div className="rounded-2xl bg-surface border border-line p-6 sm:p-8 grid md:grid-cols-[auto_1fr] gap-6 items-center">
          <p className="font-cond text-[56px] leading-none texto-degradado" style={{ fontWeight: 700 }} aria-hidden="true">9 nov.</p>
          <div>
            <h2 className="font-cond text-[30px] leading-tight" style={{ fontWeight: 700 }}>Lo usamos nosotros</h2>
            <p className="mt-2 text-[17px] leading-relaxed text-ink/85">Regenta la hace Farmagenéricos Colombia, distribuidora de medicamentos de Ibagué, y es el sistema con el que facturamos. La primera factura electrónica real emitida con Regenta fue aceptada por la DIAN el 9 de noviembre de 2026. Lo que ves en la demo es lo que usamos todos los días.</p>
          </div>
        </div>
      </section>
    </>
  );
}
