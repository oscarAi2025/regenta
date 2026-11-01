"use client";
import { useState } from "react";

/** Muestra un enlace de invitación para copiarlo o mandarlo por WhatsApp. */
export function Enlace({ enlace, nombre }: { enlace: string; nombre?: string }) {
  const [copiado, setCopiado] = useState(false);
  const texto = `Hola${nombre ? ` ${nombre.split(" ")[0]}` : ""}, este es tu enlace para activar tu cuenta de Regenta y crear tu contraseña (vence en 7 días): ${enlace}`;
  return (
    <div className="rounded-xl bg-cruz-soft p-4 grid gap-2">
      <p className="text-sm font-semibold text-cruz">Enlace de activación (vence en 7 días)</p>
      <input readOnly value={enlace} aria-label="Enlace de activación" className="campo font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(enlace); setCopiado(true); } catch { setCopiado(false); } }} className="btn-borde h-10 text-sm">{copiado ? "Copiado" : "Copiar enlace"}</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener" className="btn-primario h-10 text-sm">Enviar por WhatsApp</a>
      </div>
    </div>
  );
}
