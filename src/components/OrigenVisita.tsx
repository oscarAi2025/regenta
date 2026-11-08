"use client";
import { useEffect } from "react";

/**
 * Primer contacto del visitante (08/11/2026): de dónde llegó (utm, anuncio de Google, buscador o sitio), la campaña y la
 * primera página que vio. Se guarda 30 días en una cookie propia, sin datos personales, y el servidor la lee al entrar a
 * la demo (consola → Visitas a la demo). No se sobrescribe: cuenta la primera vez que llegó.
 */
export function OrigenVisita() {
  useEffect(() => {
    try {
      if (document.cookie.split("; ").some((c) => c.startsWith("regenta_origen="))) return;
      const q = new URLSearchParams(location.search);
      let ref = ""; try { const r = new URL(document.referrer); if (r.host !== location.host) ref = r.host.replace(/^www\./, ""); } catch {}
      const anuncio = ["gclid", "gbraid", "wbraid", "gad_source"].some((k) => q.has(k)) ? "google-ads" : q.has("fbclid") ? "facebook-ads" : "";
      const f = (q.get("utm_source") ?? "").toLowerCase().slice(0, 40) || anuncio || ref || "directo";
      const v = JSON.stringify({ f, c: (q.get("utm_campaign") ?? "").slice(0, 60), l: location.pathname.slice(0, 120), r: ref.slice(0, 80) });
      document.cookie = `regenta_origen=${encodeURIComponent(v)}; Max-Age=${30 * 86400}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch {}
  }, []);
  return null;
}
