import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PAGINAS, pagina } from "@/content/paginas";
import { PaginaProducto } from "@/components/landing/PaginaProducto";

export const dynamicParams = false;
export function generateStaticParams() { return PAGINAS.filter((p) => p.grupo === "para").map((p) => ({ ruta: p.ruta })); }
export async function generateMetadata({ params }: { params: Promise<{ ruta: string }> }): Promise<Metadata> {
  const p = pagina((await params).ruta);
  if (!p) return {};
  return { title: { absolute: p.titulo }, description: p.descripcion, alternates: { canonical: `/para/${p.ruta}` }, robots: { index: true, follow: true },
    openGraph: { type: "website", locale: "es_CO", siteName: "Regenta", title: p.titulo, description: p.descripcion, url: `/para/${p.ruta}`, images: [{ url: "/capturas/og.png", width: 1200, height: 630 }] } };
}
export default async function Para({ params }: { params: Promise<{ ruta: string }> }) {
  const p = pagina((await params).ruta);
  if (!p || p.grupo !== "para") notFound();
  return <PaginaProducto p={p} />;
}
