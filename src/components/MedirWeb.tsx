"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Páginas públicas de venta: solo aquí se mide (la app de cada droguería no se mide con esto). */
export const esPublica = (r: string) => r === "/" || /^\/(precios|funciones|guias|para|por-que-regenta|software|contratar)(\/|$)/.test(r);

function visitante() {
  try {
    let v = localStorage.getItem("regenta_v");
    if (!v || !/^[a-z0-9]{8,32}$/.test(v)) { v = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem("regenta_v", v); }
    return v;
  } catch { return null; }
}
function enviar(tipo: string, detalle?: string) {
  try {
    const cuerpo = JSON.stringify({ v: visitante(), tipo, ruta: location.pathname, detalle: detalle?.replace(/\s+/g, " ").trim().slice(0, 120) || null });
    if (!navigator.sendBeacon?.("/api/web/evento", new Blob([cuerpo], { type: "application/json" })))
      fetch("/api/web/evento", { method: "POST", headers: { "content-type": "application/json" }, body: cuerpo, keepalive: true }).catch(() => {});
  } catch {}
}

/**
 * Embudo de la web (059): una vista por página pública y cada clic a «Probar» (formulario de la demo), «Contratar»,
 * WhatsApp o el formulario de demostración. Sin cookies de terceros ni datos personales: un identificador aleatorio
 * del navegador. Va después de <OrigenVisita/> para que la primera vista ya lleve el origen.
 */
export function MedirWeb() {
  const ruta = usePathname();
  useEffect(() => { if (esPublica(ruta)) enviar("vista"); }, [ruta]);
  useEffect(() => {
    const clic = (e: MouseEvent) => {
      if (!esPublica(location.pathname)) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a) return;
      const h = a.getAttribute("href") ?? "";
      if (/(^|\/)contratar(\?|$)/.test(h)) enviar("contratar", `${a.textContent ?? ""} · ${new URL(h, location.href).searchParams.get("origen") ?? ""}`);
      else if (/wa\.me\//.test(h)) enviar("whatsapp", a.textContent ?? "");
    };
    const envio = (e: SubmitEvent) => {
      if (!esPublica(location.pathname)) return;
      const f = e.target as HTMLFormElement;
      const accion = f.getAttribute("action") ?? "";
      if (accion === "/demo") enviar("demo", (e.submitter?.textContent ?? "") || "Probar");
      else if (f.getAttribute("aria-label")?.match(/demostraci/i) || f.dataset.medir === "formulario") enviar("formulario");
    };
    document.addEventListener("click", clic, true);
    document.addEventListener("submit", envio, true);
    return () => { document.removeEventListener("click", clic, true); document.removeEventListener("submit", envio, true); };
  }, []);
  return null;
}
