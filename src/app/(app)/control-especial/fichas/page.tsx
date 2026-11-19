import { InvitacionPro } from "../InvitacionPro";
import { controlEspecialActivo } from "@/lib/control-plan";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { CAMPOS, CATEGORIAS, PLANTILLA_BASE } from "@/lib/anexo13";
import { leerConfig, moduloListo, productosAnexo } from "@/lib/anexo13-datos";
import { Pestanas } from "../Pestanas";
import { Configuracion, Fichas } from "./Editores";

export const metadata = { title: "Fichas y configuración del control especial" };

export default async function FichasConfig() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso");
  if (!(await controlEspecialActivo(s.empresa))) return <InvitacionPro dueno={s.rol === "dueno"} />; // plan sin el módulo (Esencial)
  const d = await comoUsuario(s, async (c) => (await moduloListo(c)) ? {
    productos: await productosAnexo(c, s.empresa), config: await leerConfig(c, s.empresa),
    demo: !!(await c.query(`select demo from empresas where id = $1`, [s.empresa])).rows[0]?.demo,
  } : null);
  const campos = Object.entries(CAMPOS).map(([campo, c]) => ({ campo, titulo: c.titulo }));

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Fichas y configuración" sub="Lo que necesita el informe mensual al Fondo Rotatorio de Estupefacientes" />
      <Pestanas actual="/control-especial/fichas" />
      {!d ? (
        <section className="tarjeta p-6"><h2 className="titulo text-xl">Se está activando</h2><p className="mt-1 text-muted">Las fichas estarán disponibles en unos minutos.</p></section>
      ) : (
        <>
          {d.demo && <p className="text-sm text-muted">En la demostración los cambios se ven pero no se guardan.</p>}
          <Fichas productos={d.productos} categorias={[...CATEGORIAS]} demo={d.demo} />
          <Configuracion config={d.config} base={PLANTILLA_BASE} campos={campos} demo={d.demo} />
        </>
      )}
    </main>
  );
}
