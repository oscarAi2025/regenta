import Link from "next/link";

/** Respaldo y cumplimiento: las normas que Regenta ayuda a cumplir y quién está detrás. Texto, no logos de entidades:
 *  Regenta no tiene aval de la DIAN, el INVIMA ni las superintendencias, y no lo da a entender. */
const ITEMS: [string, string, string][] = [
  ["DIAN", "POS electrónico y factura electrónica según la Resolución 000165 de 2023, emitidos por un proveedor tecnológico autorizado por la DIAN (integración en curso).", "/guias/pos-electronico-drogueria-dian"],
  ["INVIMA", "Alertas sanitarias tomadas del listado oficial del INVIMA y cruzadas con tu inventario, con enlace a cada alerta original.", "/funciones/alertas-invima"],
  ["Secretarías de salud", "Venta del lote más próximo a vencer y área de vencidos, como pide la Resolución 1403 de 2007, con evidencia lista para la visita.", "/guias/control-fechas-vencimiento-drogueria"],
  ["Datos personales", "Tratamiento de datos de clientes y usuarios conforme a la Ley 1581 de 2012; cada droguería ve solo sus datos.", ""],
];

export function Respaldo() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16" aria-labelledby="respaldo">
      <h2 id="respaldo" className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>Hecho para cumplir la norma colombiana</h2>
      <p className="mt-3 text-lg text-muted max-w-3xl">Regenta lo respalda Farmagenéricos Colombia, de IA DEV INVESTIMENTS COLOMBIA S.A.S. (NIT 901.845.370-5), y está construido sobre las reglas que vigilan a tu droguería.</p>
      <ul className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {ITEMS.map(([t, d, h]) => (
          <li key={t}>{h ? (
            <Link href={h} className="tarjeta block p-5 h-full hover:border-ink"><p className="font-cond text-2xl" style={{ fontWeight: 700 }}>{t}</p><p className="mt-2 text-muted leading-relaxed">{d}</p></Link>
          ) : (
            <div className="tarjeta p-5 h-full"><p className="font-cond text-2xl" style={{ fontWeight: 700 }}>{t}</p><p className="mt-2 text-muted leading-relaxed">{d}</p></div>
          )}</li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">Los nombres de las entidades se mencionan como referencia de las normas que Regenta ayuda a cumplir; no implican aval ni certificación de esas entidades.</p>
    </section>
  );
}
