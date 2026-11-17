import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { modoDe } from "@/lib/modo";
import { puedeEntregar } from "@/lib/entregas-datos";
import { NuevaEntrega } from "./NuevaEntrega";

export const metadata = { title: "Nueva entrega interna" };

export default async function PaginaNuevaEntrega() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeEntregar(s.rol)) redirect("/inicio?aviso=permiso");
  const e = await comoUsuario(s, async (c) => (await modoDe(c, s.empresa)) === "interno"
    ? (await c.query(`select formula_vigencia_dias, formula_exige_datos from empresas where id = $1`, [s.empresa])).rows[0] : null);
  if (!e) redirect("/caja");
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Nueva entrega interna" sub="Sale primero el lote que vence antes. Lo vencido y lo separado por el INVIMA no se entrega." />
      <NuevaEntrega cfg={{ vigencia_dias: Number(e.formula_vigencia_dias ?? 30), exige_datos: !!e.formula_exige_datos }} />
    </main>
  );
}
