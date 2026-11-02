import { redirect } from "next/navigation";
import { leerSesion, puede } from "@/lib/sesion";
import { comoUsuario } from "@/lib/db";
import { Caja } from "./Caja";

export const metadata = { title: "Caja" };

export default async function PaginaCaja() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inventario?aviso=permiso");
  const e = await comoUsuario(s, async (c) => (await c.query(`select coalesce(e.nombre_comercial, e.razon_social) n,
      not e.demo and not exists (select 1 from resoluciones_dian r where r.empresa_id = e.id and r.activa and r.tipo = 'pos' and not r.pruebas) sin_habilitar
    from empresas e where e.id = $1`, [s.empresa])).rows[0]);
  return (
    <main>
      <h1 className="sr-only">Caja</h1>
      {e?.sin_habilitar && (
        <div role="status" className="mx-4 mt-4 rounded-lg border-2 border-aviso bg-aviso-soft px-4 py-3 text-sm">
          <b>Tu droguería aún no está habilitada ante la DIAN.</b> La caja vende en cuanto carguemos tu resolución de numeración.
          Mientras tanto, deja todo listo: carga tus productos e inventario y crea a tu equipo. ¿Dudas? WhatsApp +57 321 214 1970.
        </div>
      )}
      <Caja fiar={puede.fiar(s.rol)} empresa={s.empresa} nombreEmpresa={e?.n ?? ""} />
    </main>
  );
}
