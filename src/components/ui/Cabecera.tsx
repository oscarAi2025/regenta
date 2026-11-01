/** Título de página con acciones a la derecha. */
export function Cabecera({ titulo, sub, children }: { titulo: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="titulo text-[32px] leading-tight">{titulo}</h1>
        {sub && <p className="text-muted mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Dato({ titulo, valor, tono, nota }: { titulo: string; valor: React.ReactNode; tono?: "alerta" | "aviso" | "cruz"; nota?: React.ReactNode }) {
  const c = tono === "alerta" ? "text-alerta" : tono === "aviso" ? "text-aviso" : tono === "cruz" ? "text-cruz" : "text-ink";
  return (
    <div className="tarjeta px-4 py-3.5">
      <p className="text-sm text-muted">{titulo}</p>
      <p className={`num titulo text-[30px] leading-tight ${c}`}>{valor}</p>
      {nota && <p className="text-[13px] text-muted mt-0.5">{nota}</p>}
    </div>
  );
}

export const pesos = (n: number) => "$" + Math.round(Number(n)).toLocaleString("es-CO");
export const existenciasTexto = (unidades: number, upc: number) => {
  if (unidades <= 0) return "Agotado";
  if (upc <= 1) return `${unidades} und`;
  const c = Math.floor(unidades / upc), u = unidades % upc;
  return `${c} caja${c === 1 ? "" : "s"}${u ? ` + ${u} und` : ""}`;
};
