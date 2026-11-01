import type { Metadata } from "next";
import { metaPublica } from "@/lib/seo";
import { IndiceSilo } from "@/components/landing/IndiceSilo";

export const metadata: Metadata = metaPublica("/para", "Regenta para regentes y dueños de droguería", "Cómo usa Regenta cada persona de la droguería: el regente con lotes, vencimientos y alertas INVIMA; el dueño con ventas, ganancia y pedido desde el celular.");
export default function Para() {
  return <IndiceSilo grupo="para" ruta="/para" h1="¿Para quién es Regenta?" entradilla="Cada persona de la droguería ve lo que necesita: el regente cumple la norma sin papeles, el dueño ve su negocio en números y la auxiliar vende rápido." />;
}
