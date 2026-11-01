import type { Metadata } from "next";
import { metaPublica } from "@/lib/seo";
import { IndiceSilo } from "@/components/landing/IndiceSilo";

export const metadata: Metadata = metaPublica("/software", "Software para droguerías, farmacias y distribuidoras", "Software farmacéutico en Colombia: facturación electrónica, POS para droguería, inventario de farmacia por lote y software para distribuidoras.");
export default function Software() {
  return <IndiceSilo grupo="software" ruta="/software" h1="Software para el sector farmacéutico" entradilla="Facturación electrónica, POS, inventario por lote, cartera e IA para droguerías, farmacias y distribuidoras de medicamentos. Elige lo que buscas." />;
}
