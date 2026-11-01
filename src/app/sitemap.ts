import type { MetadataRoute } from "next";
import { GUIAS } from "@/content/guias";
import { PAGINAS } from "@/content/paginas";
import { SITIO } from "@/lib/sitio";

export default function sitemap(): MetadataRoute.Sitemap {
  const fijo = (ruta: string, priority: number) => ({ url: `${SITIO}${ruta}`, changeFrequency: "monthly" as const, priority });
  return [
    fijo("/", 1), fijo("/precios", 0.9), fijo("/funciones", 0.8), fijo("/por-que-regenta", 0.7), fijo("/guias", 0.7),
    ...PAGINAS.map((p) => fijo(`/${p.grupo}/${p.ruta}`, 0.8)),
    ...GUIAS.map((g) => ({ url: `${SITIO}/guias/${g.slug}`, lastModified: g.actualizada, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
