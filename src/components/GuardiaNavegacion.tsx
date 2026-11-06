"use client";
import { useEffect } from "react";

/**
 * Guardia de navegación. El enrutador de Next.js 15 a veces deja colgada una navegación interna: la respuesta del
 * servidor llega completa pero la pantalla nunca cambia (lo medimos en local: hasta 1 de cada 5 clics en algunos enlaces
 * de Inventario). Aquí se vigila solo ese caso exacto: tras un clic en un enlace interno, cuando el navegador ya recibió
 * entera la respuesta de esa pantalla (registro de recursos) y aun así la dirección no cambió en ESPERA ms, se carga la
 * pantalla de forma normal. Si el servidor tarda, no se hace nada: la respuesta todavía no ha terminado de llegar.
 */
const ESPERA = 2500;

export function GuardiaNavegacion() {
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let pendiente: { destino: URL; desde: string; vence: number; inicio: number } | null = null;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const clave = (u: URL) => {
      const q = new URLSearchParams(u.search); q.delete("_rsc");
      return u.pathname + (q.toString() ? "?" + q.toString() : "");
    };

    const clic = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      let destino: URL;
      try { destino = new URL(a.href, location.href); } catch { return; }
      if (destino.origin !== location.origin) return;
      if (clave(destino) === clave(new URL(location.href))) return; // misma pantalla (o solo un #ancla)
      pendiente = { destino, desde: location.href, vence: Date.now() + 30000, inicio: performance.now() };
    };

    const obs = new PerformanceObserver((lista) => {
      const p = pendiente;
      if (!p || Date.now() > p.vence) { pendiente = null; return; }
      for (const e of lista.getEntries()) {
        // Solo la petición que salió por este clic (un prefetch por pasar el puntero empieza antes y no cuenta).
        if (!e.name.includes("_rsc=") || e.startTime < p.inicio) continue;
        let u: URL;
        try { u = new URL(e.name); } catch { continue; }
        if (clave(u) !== clave(p.destino)) continue;
        // La respuesta de la pantalla pedida ya llegó entera: si en ESPERA ms la dirección no cambió, se carga normal.
        clearTimeout(reloj);
        reloj = setTimeout(() => {
          if (pendiente === p && location.href === p.desde) location.assign(p.destino.href);
          pendiente = null;
        }, ESPERA);
      }
    });
    try { obs.observe({ type: "resource", buffered: false }); } catch { return; }

    const salir = () => { pendiente = null; clearTimeout(reloj); };
    document.addEventListener("click", clic, true);
    window.addEventListener("popstate", salir);
    return () => { document.removeEventListener("click", clic, true); window.removeEventListener("popstate", salir); obs.disconnect(); clearTimeout(reloj); };
  }, []);
  return null;
}
