import type { MetadataRoute } from "next";
import { SITIO } from "@/lib/sitio";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/inicio", "/caja", "/ventas", "/productos", "/inventario"] }],
    sitemap: `${SITIO}/sitemap.xml`,
  };
}
