import { metaPublica } from "@/lib/seo";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PAGINAS, pagina } from "@/content/paginas";
import { PaginaProducto } from "@/components/landing/PaginaProducto";

export const dynamicParams = false;
export function generateStaticParams() { return PAGINAS.filter((p) => p.grupo === "para").map((p) => ({ ruta: p.ruta })); }
export async function generateMetadata({ params }: { params: Promise<{ ruta: string }> }): Promise<Metadata> {
  const p = pagina((await params).ruta);
  if (!p) return {};
  return metaPublica(`/para/${p.ruta}`, p.titulo, p.descripcion);
}
export default async function Para({ params }: { params: Promise<{ ruta: string }> }) {
  const p = pagina((await params).ruta);
  if (!p || p.grupo !== "para") notFound();
  return <PaginaProducto p={p} />;
}
