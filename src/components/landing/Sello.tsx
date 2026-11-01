import Link from "next/link";

/** Sellos de confianza en texto y con iconos propios. Nunca logos de entidades del Estado: ninguna avala ni certifica
 *  a Regenta, y su proveedor de emisión trabaja en la modalidad de software propio (no es proveedor tecnológico). */
const SELLOS: [string, string, string, string][] = [
  ["Facturación electrónica DIAN", "POS y factura según la Resolución 165 de 2023", "/funciones/facturacion-electronica", "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5"],
  ["Alertas oficiales", "del listado de alertas sanitarias del INVIMA", "/funciones/alertas-invima", "M12 4l9 16H3zM12 10v4M12 17h.01"],
  ["Datos protegidos", "Ley 1581 de 2012, cada empresa ve solo lo suyo", "/por-que-regenta", "M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2"],
];
export function Sello({ oscuro = false, apilado = false }: { oscuro?: boolean; apilado?: boolean }) {
  return (
    <ul className={`grid gap-3 ${apilado ? "" : "sm:grid-cols-3"}`} aria-label="Respaldo">
      {SELLOS.map(([t, d, h, ico]) => (
        <li key={t}><Link href={h} className={`flex items-start gap-3 rounded-2xl px-3.5 py-3 h-full border ${oscuro ? "border-white/15 bg-white/[.06] hover:bg-white/10" : "border-line bg-surface hover:border-teal-600"}`}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={oscuro ? "#5eead4" : "#0f766e"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true"><path d={ico} /></svg>
          <span className="leading-snug"><span className={`block font-semibold text-[14px] ${oscuro ? "text-white" : ""}`}>{t}</span><span className={`block text-[12.5px] ${oscuro ? "text-white/60" : "text-muted"}`}>{d}</span></span>
        </Link></li>
      ))}
    </ul>
  );
}
