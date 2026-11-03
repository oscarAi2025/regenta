import type { MetadataRoute } from "next";
import { GUIAS } from "@/content/guias";
import { PAGINAS } from "@/content/paginas";
import { SITIO } from "@/lib/sitio";

export default function sitemap(): MetadataRoute.Sitemap {
  // Fecha real del último cambio de contenido de cada página fija (no la del despliegue: Google desconfía de fechas que
  // cambian sin cambios). Al editar una página, actualizar su fecha aquí.
  const CAMBIO: Record<string, string> = { "/": "2026-11-03", "/precios": "2026-11-03" };
  const fijo = (ruta: string, priority: number) => ({ url: `${SITIO}${ruta}`, changeFrequency: "monthly" as const, priority, ...(CAMBIO[ruta] ? { lastModified: CAMBIO[ruta] } : {}) });
  return [
    fijo("/", 1), fijo("/precios", 0.9), fijo("/funciones", 0.8), fijo("/por-que-regenta", 0.7), fijo("/guias", 0.7), fijo("/contratar", 0.8), fijo("/software", 0.9), fijo("/para", 0.6), fijo("/privacidad", 0.2), fijo("/terminos", 0.2),
    ...PAGINAS.map((p) => fijo(`/${p.grupo}/${p.ruta}`, 0.8)),
    ...GUIAS.map((g) => ({ url: `${SITIO}/guias/${g.slug}`, lastModified: g.actualizada, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
