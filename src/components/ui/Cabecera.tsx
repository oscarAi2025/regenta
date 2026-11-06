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
    <div className="tarjeta px-4 py-3.5 min-w-0">
      <p className="text-sm text-muted">{titulo}</p>
      {/* En celulares de 320 px una cifra en pesos de dos columnas no cabía a 30 px: baja de tamaño y, en último caso, parte. */}
      <p className={`num titulo text-[clamp(20px,6.5vw,30px)] leading-tight [overflow-wrap:anywhere] ${c}`}>{valor}</p>
      {nota && <p className="text-[13px] text-muted mt-0.5">{nota}</p>}
    </div>
  );
}

export { pesos, existenciasTexto } from "@/lib/formato";
