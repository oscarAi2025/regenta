import type { MetadataRoute } from "next";
import { SITIO } from "@/lib/sitio";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITIO}/`, changeFrequency: "monthly", priority: 1 }];
}
