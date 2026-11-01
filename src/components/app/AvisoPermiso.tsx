"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/** Cuando una pantalla no corresponde al rol del usuario, se le explica en vez de redirigir en silencio. */
export function AvisoPermiso() {
  const sp = useSearchParams();
  const [ver, setVer] = useState(false);
  useEffect(() => {
    if (sp.get("aviso") !== "permiso") return;
    setVer(true);
    history.replaceState(null, "", location.pathname); // quita el parámetro sin volver a cargar la pantalla
    const t = setTimeout(() => setVer(false), 6000);
    return () => clearTimeout(t);
  }, [sp]);
  if (!ver) return null;
  return (
    <p role="status" className="mx-4 sm:mx-6 mt-4 rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold flex items-center justify-between gap-3">
      Esa pantalla no está disponible para tu usuario. Si la necesitas, pídele acceso al dueño de la droguería.
      <button onClick={() => setVer(false)} aria-label="Cerrar aviso" className="text-xl leading-none">×</button>
    </p>
  );
}
