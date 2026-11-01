import type { Metadata } from "next";

/** Metadatos completos de una página pública: título, descripción, canonical, robots y Open Graph/Twitter. */
export function metaPublica(ruta: string, titulo: string, descripcion: string, tipo: "website" | "article" = "website"): Metadata {
  return {
    title: { absolute: titulo }, description: descripcion, alternates: { canonical: ruta }, robots: { index: true, follow: true },
    openGraph: { type: tipo, locale: "es_CO", siteName: "Regenta", title: titulo, description: descripcion, url: ruta, images: [{ url: "/capturas/og.png", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: titulo, description: descripcion, images: ["/capturas/og.png"] },
  };
}
