import type { MetadataRoute } from "next";
import { GUIAS } from "@/content/guias";
import { SITIO } from "@/lib/sitio";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITIO}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${SITIO}/guias`, changeFrequency: "monthly", priority: 0.7 },
    ...GUIAS.map((g) => ({ url: `${SITIO}/guias/${g.slug}`, lastModified: g.actualizada, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
