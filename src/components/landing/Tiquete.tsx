/** El tiquete de la portada: así sale una venta real de Regenta (datos de ejemplo). Se «imprime» una vez al cargar. */
const LINEAS = [
  { n: "Losartán 50 mg x 30 tab", d: "Lote L2405 · vence mar 2027", c: "1 caja", v: "18.900" },
  { n: "Acetaminofén 500 mg", d: "Lote A1180 · vence ago 2027", c: "10 und", v: "2.000", f: true },
  { n: "Suero oral 500 ml", d: "Lote S332 · vence ene 2027", c: "2 und", v: "7.600" },
];
export function Tiquete() {
  return (
    <figure className="tirilla w-[310px] sm:w-[340px] px-6 pt-6 pb-10 font-cond text-ink rotate-[1.5deg]" aria-label="Ejemplo de tiquete de venta de Regenta">
      <div className="imprime text-center" style={{ animationDelay: "0ms" }}>
        <p className="text-[22px] leading-none" style={{ fontWeight: 700 }}>DROGUERÍA SAN RAFAEL</p>
        <p className="text-[13px] text-muted mt-1">NIT 900.000.001-1 · Caja 1 · Laura</p>
      </div>
      <div className="corte my-3" />
      <ul className="grid gap-2.5 text-[15px]">
        {LINEAS.map((l, i) => (
          <li key={l.n} className="imprime" style={{ animationDelay: `${300 + i * 380}ms` }}>
            <div className="flex justify-between gap-3"><span style={{ fontWeight: 600 }}>{l.n}</span><span className="num">{l.v}</span></div>
            <div className="flex justify-between gap-3 text-[12.5px] text-muted"><span>{l.d}</span><span>{l.c}{l.f ? " · suelto" : ""}</span></div>
          </li>
        ))}
      </ul>
      <div className="corte my-3" />
      <div className="imprime" style={{ animationDelay: "1500ms" }}>
        <div className="flex justify-between text-[26px] leading-none" style={{ fontWeight: 700 }}><span>TOTAL</span><span className="num">$28.500</span></div>
        <div className="flex justify-between text-[14px] mt-2"><span>Nequi</span><span className="num">28.500</span></div>
      </div>
      <div className="imprime mt-4 rounded-lg bg-cruz-soft text-cruz px-3 py-2 text-[13px] leading-snug" style={{ animationDelay: "1900ms", fontWeight: 600 }}>
        Salió primero el lote que vence antes. Quedan 3 cajas de losartán.
      </div>
    </figure>
  );
}
