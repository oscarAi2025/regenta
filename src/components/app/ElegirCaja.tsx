"use client";

/** Con qué caja trabaja esta computadora o celular (solo aparece si la droguería tiene más de una caja activa).
 *  Se guarda en este navegador: la computadora del mostrador queda como «Caja 1», la del fondo como «Caja 2», etc. */
export function ElegirCaja({ cajas, actual }: { cajas: { id: string; nombre: string }[]; actual: string | null }) {
  if (cajas.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted">Esta computadora es</span>
      <select aria-label="Caja de esta computadora" className="campo h-9 py-1 w-auto font-semibold" value={actual ?? ""}
        onChange={(e) => { document.cookie = `regenta_caja=${e.target.value}; path=/; max-age=31536000; samesite=lax`; location.reload(); }}>
        {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
    </label>
  );
}
