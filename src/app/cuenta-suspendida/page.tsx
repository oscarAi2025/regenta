import Link from "next/link";
import { redirect } from "next/navigation";
import { Marca } from "@/components/Marca";
import { leerSesion, leerSesionConsulta } from "@/lib/sesion";
import { estadoCuenta } from "@/lib/consulta";
import { wa } from "@/lib/sitio";
import { Salir } from "./Salir";

export const metadata = { title: "Cuenta en pausa", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

/** Modo consulta: la droguería está suspendida por falta de pago. El dueño renueva en un clic (con sus datos ya puestos)
 *  y, mientras tanto, dueño y administrador descargan sus facturas electrónicas y la copia de sus datos: la suspensión
 *  pausa la caja y la facturación, nunca se queda con los documentos de la droguería. */
export default async function CuentaSuspendida() {
  const s = await leerSesionConsulta();
  if (!s) redirect((await leerSesion()) ? "/inicio" : "/entrar");
  const e = await estadoCuenta(s.empresa);
  if (!e) redirect("/entrar");
  const dueno = s.rol === "dueno";
  const renovar = `/contratar?plan=${e.plan === "pro" ? "pro" : "esencial"}&renovar=1`;
  return (
    <main className="min-h-screen bg-paper">
      <header className="bg-ink text-white px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
        <Marca claro />
        <Salir />
      </header>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-5">
        {s.activa ? (
          <section className="tarjeta p-6 grid gap-3" aria-label="Cuenta reactivada">
            <h1 className="titulo text-3xl">Tu pago se aprobó: Regenta ya está activa</h1>
            <p className="text-muted">{e.nombre} vuelve a vender y facturar desde ya. Todo quedó como lo dejaste.</p>
            <a href="/cuenta-suspendida/continuar" className="btn-primario h-12 w-fit">Entrar a Regenta</a>
          </section>
        ) : (
          <section className="tarjeta p-6 grid gap-3" aria-label="Cuenta en pausa">
            <p className="text-sm font-semibold text-alerta">Cuenta en pausa por falta de pago</p>
            <h1 className="titulo text-3xl">El plan de {e.nombre} venció{e.vence ? ` el ${e.vence}` : ""}</h1>
            <p>La caja y la facturación están en pausa hasta que renueves. <b>Tus datos están guardados y completos</b>: productos, inventario, clientes, ventas y documentos electrónicos. Al aprobarse el pago, todo vuelve a funcionar al instante, sin llamar a nadie.</p>
            {dueno
              ? <div data-compra className="flex flex-wrap items-center gap-3"><Link href={renovar} className="btn-primario h-12">Renovar ahora</Link><span className="text-sm text-muted">Tus datos ya van puestos: solo eliges cómo pagar.</span></div>
              : <p className="font-semibold">Avísale al dueño de la droguería para que renueve el plan: en cuanto pague, vuelves a entrar normal.</p>}
          </section>
        )}
        <section className="tarjeta p-6 grid gap-4" aria-label="Tus documentos">
          <div>
            <h2 className="titulo text-xl">Tus documentos siguen siendo tuyos</h2>
            <p className="text-sm text-muted">La ley te pide conservar tus facturas electrónicas y tenerlas a mano si la DIAN las pide. Descárgalas cuando quieras, también con el plan vencido.</p>
          </div>
          <form action="/api/consulta/xml" method="get" className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <label className="grid gap-1 text-sm font-semibold">Desde<input type="date" name="desde" className="campo font-normal" defaultValue={e.primer_documento ?? hoy()} max={hoy()} required /></label>
            <label className="grid gap-1 text-sm font-semibold">Hasta<input type="date" name="hasta" className="campo font-normal" defaultValue={hoy()} max={hoy()} required /></label>
            <button className="btn-borde h-12">Descargar XML (ZIP)</button>
          </form>
          <p className="text-sm text-muted">{e.documentos.toLocaleString("es-CO")} documentos electrónicos registrados. Cada XML es el documento válido ante la DIAN (factura, tiquete POS o nota), con su CUFE/CUDE.</p>
          {dueno && (
            <div className="border-t border-line pt-4 flex flex-wrap items-center gap-3">
              <a href="/api/consulta/copia" className="btn-borde h-12">Descargar copia completa de mis datos</a>
              <span className="text-sm text-muted">ZIP con productos, inventario, clientes, ventas y documentos en archivos que abre Excel.</span>
            </div>
          )}
        </section>
        <p data-compra className="text-sm text-muted">¿Dudas con el pago? <a className="underline" href={wa(`Hola, soy de ${e.nombre} (NIT ${e.nit}) y quiero renovar Regenta`)}>Escríbenos por WhatsApp</a> y te ayudamos.</p>
      </div>
    </main>
  );
}
