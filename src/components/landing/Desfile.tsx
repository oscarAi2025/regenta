/** Franja que desfila con todo lo que hace Regenta (y palabras que la gente busca). Con movimiento reducido queda quieta. */
const COSAS = ["Factura electrónica", "POS electrónico DIAN", "Notas crédito", "Inventario por lote", "Vende primero lo que vence antes", "Venta por unidad",
  "Crédito y cartera", "Pedido sugerido", "Alertas INVIMA", "Regenta IA", "Prioridades del día", "Roles y auditoría", "Carga desde Excel", "Nequi, Daviplata y Bre-B"];
export function Desfile() {
  const fila = [...COSAS, ...COSAS];
  return (
    <div className="overflow-hidden degradado-marca text-white py-3.5" aria-label="Lo que hace Regenta">
      <ul className="desfile flex w-max gap-8 font-cond text-lg whitespace-nowrap" style={{ fontWeight: 600 }}>
        {fila.map((c, i) => <li key={i} className="flex items-center gap-8" aria-hidden={i >= COSAS.length}>{c}<span className="text-amber-300" aria-hidden="true">✦</span></li>)}
      </ul>
    </div>
  );
}
