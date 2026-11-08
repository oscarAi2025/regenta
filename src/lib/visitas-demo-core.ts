/**
 * Lógica pura de las visitas a la demo (sin servidor ni base): se prueba con tests/visitas-demo.test.mjs.
 */
const corto = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n) : "") || null;

/** Ciudad, departamento y país de la cabecera x-nf-geo de Netlify (JSON en base64, o JSON plano). */
export function geoDesde(h: string | null): { ciudad: string | null; region: string | null; pais: string | null } {
  if (!h) return { ciudad: null, region: null, pais: null };
  try {
    const raw = h.trim().startsWith("{") ? h : Buffer.from(h, "base64").toString("utf8");
    const g = JSON.parse(raw) as { city?: string; subdivision?: { name?: string; code?: string }; country?: { name?: string; code?: string } };
    return { ciudad: corto(g.city, 80), region: corto(g.subdivision?.name ?? g.subdivision?.code, 80), pais: corto(g.country?.code ?? g.country?.name, 40) };
  } catch { return { ciudad: null, region: null, pais: null }; }
}

/** Tipo de dispositivo, navegador y sistema a partir del navegador del visitante (sin huellas digitales). */
export function dispositivo(ua: string) {
  const u = ua.toLowerCase();
  const disp = /ipad|tablet|(android(?!.*mobile))/.test(u) ? "tablet" : /mobi|iphone|android/.test(u) ? "celular" : u ? "computador" : null;
  const nav = /edg\//.test(u) ? "Edge" : /opr\/|opera/.test(u) ? "Opera" : /samsungbrowser/.test(u) ? "Samsung Internet" : /chrome|crios/.test(u) ? "Chrome" : /firefox|fxios/.test(u) ? "Firefox" : /safari/.test(u) ? "Safari" : null;
  const so = /windows/.test(u) ? "Windows" : /iphone|ipad|ios/.test(u) ? "iOS" : /android/.test(u) ? "Android" : /mac os/.test(u) ? "macOS" : /linux/.test(u) ? "Linux" : null;
  return { dispositivo: disp, navegador: nav, sistema: so };
}

/** Origen guardado en el primer contacto (cookie que pone <OrigenVisita/>): fuente, campaña, primera página y referente. */
export function leerOrigen(valor: string | undefined) {
  try {
    let v = valor ?? ""; try { v = decodeURIComponent(v); } catch {}
    const o = JSON.parse(v || "{}") as Record<string, unknown>;
    return { origen: corto(o.f, 60), campana: corto(o.c, 80), landing: corto(o.l, 160), referente: corto(o.r, 120) };
  } catch { return { origen: null, campana: null, landing: null, referente: null }; }
}
