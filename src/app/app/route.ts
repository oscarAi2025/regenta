import { COOKIE_APP, esPlataformaApp } from "@/lib/app-movil";

// Entrada de la app de Android: marca la plataforma (1 año) y lleva a la consola (sin sesión, la consola manda a entrar).
// Redirección relativa: en Netlify req.url puede traer el host interno del despliegue.
export function GET(req: Request) {
  const u = new URL(req.url);
  const plataforma = u.searchParams.get("plataforma");
  const h = new Headers({ Location: "/inicio", "cache-control": "private, no-store" });
  if (esPlataformaApp(plataforma))
    h.append("set-cookie", `${COOKIE_APP}=${plataforma}; Path=/; Max-Age=${365 * 86400}; SameSite=Lax${u.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https" ? "; Secure" : ""}`);
  return new Response(null, { status: 302, headers: h });
}
