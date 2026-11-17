import Link from "next/link";
import { pesos } from "@/lib/formato";
import { GRACIA_DIAS } from "@/lib/operacion";

/** Franja de aviso del plan: vence en 5 días o menos (sin renovación automática), ya venció (días de gracia) o hay
 *  documentos adicionales por pagar. El dueño ve el botón para renovar; los demás, a quién avisar. */
export function AvisoPlan({ rol, dias, vence, autorenueva, plan, cargos }: { rol: string; dias: number | null; vence: string | null; autorenueva: boolean; plan: string; cargos: number }) {
  const dueno = rol === "dueno", gerencia = dueno || rol === "admin";
  const renovar = <Link href={`/contratar?plan=${plan === "pro" ? "pro" : "esencial"}&renovar=1`} className="underline font-bold whitespace-nowrap">Renovar ahora</Link>;
  const quedan = dias === null ? 0 : GRACIA_DIAS + dias;
  if (dias !== null && dias < 0) return (
    <p role="alert" className="bg-alerta text-white px-4 sm:px-6 py-2 text-sm font-semibold flex flex-wrap items-center justify-between gap-2">
      <span>El plan de la droguería venció el {vence}. {quedan <= 0 ? "Hoy" : quedan === 1 ? "Mañana" : `En ${quedan} días`} la caja se detiene y la cuenta pasa a modo consulta: tus datos, facturas y XML quedan guardados y descargables.{dueno ? "" : " Avísale al dueño."}</span>{dueno && renovar}
    </p>);
  if (dias !== null && dias <= 5 && !autorenueva && gerencia) return (
    <p className="bg-amber-300 text-[#0b1f33] px-4 sm:px-6 py-2 text-sm font-semibold flex flex-wrap items-center justify-between gap-2">
      <span>El plan vence {dias === 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`} ({vence}).{dueno ? " Renuévalo para que la caja no se detenga." : " Avísale al dueño."}</span>{dueno && renovar}
    </p>);
  if (cargos > 0 && gerencia) return (
    <p className="bg-amber-100 text-[#0b1f33] px-4 sm:px-6 py-2 text-sm font-semibold flex flex-wrap items-center justify-between gap-2">
      <span>Hay {pesos(cargos)} de documentos adicionales por pagar (se pasó el cupo del plan).</span>{dueno && <Link href="/equipo" className="underline font-bold">Ver detalle</Link>}
    </p>);
  return null;
}
