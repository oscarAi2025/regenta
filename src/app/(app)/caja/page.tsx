import { redirect } from "next/navigation";
import { leerSesion, puede } from "@/lib/sesion";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { cajaElegida } from "@/lib/caja-elegida";
import { ElegirCaja } from "@/components/app/ElegirCaja";
import { Caja } from "./Caja";
import { puedePedidos } from "@/lib/pedidos";

export const metadata = { title: "Caja" };

export default async function PaginaCaja() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect(puedePedidos.armar(s.rol) ? "/pedidos?aviso=permiso" : "/inventario?aviso=permiso"); // el vendedor arma pedidos, no cobra
  const elegida = await cajaElegida();
  const { e, cajas, actual } = await comoUsuario(s, async (c) => ({
    e: (await c.query(`select coalesce(e.nombre_comercial, e.razon_social) n, e.factura_formato, e.formula_vigencia_dias, e.formula_exige_datos, e.responsable_iva, e.descuento_max_cajero::float,
      not e.demo and not exists (select 1 from resoluciones_dian r where r.empresa_id = e.id and r.activa and r.tipo in ('pos', 'factura') and not r.pruebas) sin_habilitar,
      not e.demo and exists (select 1 from resoluciones_dian r where r.empresa_id = e.id and r.activa and r.tipo = 'factura' and not r.pruebas)
        and not exists (select 1 from resoluciones_dian r where r.empresa_id = e.id and r.activa and r.tipo = 'pos' and not r.pruebas) solo_factura
    from empresas e where e.id = $1`, [s.empresa])).rows[0],
    cajas: (await c.query(`select id, nombre from cajas where empresa_id = $1 and activa order by nombre`, [s.empresa])).rows as { id: string; nombre: string }[],
    actual: (await puestoDeTrabajo(c, s.empresa, elegida)).caja_id,
  }));
  return (
    <main>
      <h1 className="sr-only">Caja</h1>
      {e?.sin_habilitar && (
        <div role="status" className="mx-4 mt-4 rounded-lg border-2 border-aviso bg-aviso-soft px-4 py-3 text-sm">
          <b>Tu droguería aún no está habilitada ante la DIAN.</b> La caja vende en cuanto carguemos tu resolución de numeración.
          Mientras tanto, deja todo listo: carga tus productos e inventario y crea a tu equipo. ¿Dudas? WhatsApp +57 321 214 1970.
        </div>
      )}
      {cajas.length > 1 && <div className="mx-4 mt-3 flex justify-end"><ElegirCaja cajas={cajas} actual={actual} /></div>}
      <Caja fiar={puede.fiar(s.rol)} gerencia={puede.cartera(s.rol)} empresa={s.empresa} nombreEmpresa={e?.n ?? ""} caja={actual}
        responsableIva={e?.responsable_iva !== false} descuentoMax={s.rol === "cajero" ? Number(e?.descuento_max_cajero ?? 10) : null}
        formulas={{ vigencia_dias: Number(e?.formula_vigencia_dias ?? 30), exige_datos: !!e?.formula_exige_datos }} soloFactura={!!e?.solo_factura} facturaFormato={e?.factura_formato === "tirilla" ? "tirilla" : "carta"} />
    </main>
  );
}
