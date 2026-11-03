import { metaPublica } from "@/lib/seo";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PAGINAS, pagina } from "@/content/paginas";
import { PaginaProducto } from "@/components/landing/PaginaProducto";

export const dynamicParams = false;
export function generateStaticParams() { return PAGINAS.filter((p) => p.grupo === "funciones").map((p) => ({ ruta: p.ruta })); }
export async function generateMetadata({ params }: { params: Promise<{ ruta: string }> }): Promise<Metadata> {
  const p = pagina((await params).ruta);
  if (!p) return {};
  return metaPublica(`/funciones/${p.ruta}`, p.titulo, p.descripcion);
}
export default async function Funcion({ params }: { params: Promise<{ ruta: string }> }) {
  const p = pagina((await params).ruta);
  if (!p || p.grupo !== "funciones") notFound();
  return <PaginaProducto p={p} />;
}
