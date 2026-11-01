/** Portada: los tres avisos que Regenta le da a una droguería (ejemplo), apareciendo una sola vez al cargar. */
const AVISOS = [
  { tono: "bg-alerta text-white", t: "Alerta INVIMA 329-2026", d: "Tienes 40 unidades del lote F0537A de Buscapina Compositum NF. Sepáralo de la venta.", a: "Revisar ahora" },
  { tono: "bg-surface text-ink border border-line", t: "Se vencerían sin venderse: $412.300", d: "6 lotes antes de marzo, al ritmo de venta actual. Ponlos en exhibición o devuélvelos a tiempo.", a: "Ver lotes" },
  { tono: "bg-ink text-white", t: "Pedido sugerido listo: 28 productos", d: "7 se agotan esta semana. Cajas calculadas con tus ventas de 8 semanas.", a: "Enviar por WhatsApp" },
];
export function Avisos() {
  return (
    <div className="grid gap-3 w-full max-w-[400px]" aria-label="Ejemplo de avisos de Regenta">
      {AVISOS.map((x, i) => (
        <div key={x.t} className={`imprime rounded-2xl p-4 shadow-[0_20px_40px_-24px_rgba(16,42,67,.5)] ${x.tono} ${i === 1 ? "sm:-ml-6" : i === 2 ? "sm:ml-6" : ""}`} style={{ animationDelay: `${200 + i * 450}ms` }}>
          <p className="font-cond text-[21px] leading-tight" style={{ fontWeight: 700 }}>{x.t}</p>
          <p className="mt-1 text-[15px] opacity-85 leading-snug">{x.d}</p>
          <p className="mt-2 text-sm font-semibold underline underline-offset-2">{x.a}</p>
        </div>
      ))}
    </div>
  );
}
