import type { Metadata } from "next";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { metaPublica } from "@/lib/seo";
import { CORREO, TELEFONO, wa } from "@/lib/sitio";

// Exigida por Google Play para las apps con cuentas (28/11/2026): cómo pedir que se elimine la cuenta y qué datos se
// borran o se conservan. Se abre también dentro de la app (no es web de venta).
export const metadata: Metadata = metaPublica("/eliminar-cuenta", "Eliminar tu cuenta de Regenta", "Cómo pedir que se elimine tu cuenta de Regenta y la de tu droguería, qué datos se borran y cuáles se conservan por obligación legal.");

const h2 = "font-cond text-3xl";

export default function EliminarCuenta() {
  return (
    <div className="bg-paper text-ink min-h-screen">
      <CabeceraPublica />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 grid gap-5 text-[17px] leading-relaxed">
        <h1 className="font-cond text-[40px] sm:text-[52px] leading-[1]" style={{ fontWeight: 700 }}>Eliminar tu cuenta de Regenta</h1>
        <p>Regenta es el software de facturación electrónica, caja e inventario para droguerías de IA DEV INVESTIMENTS COLOMBIA S.A.S. (NIT 901.845.370-5), propietaria de Farmagenéricos Colombia. Aquí te explicamos cómo pedir que eliminemos tu cuenta y qué pasa con tus datos.</p>

        <h2 className={h2} style={{ fontWeight: 700 }}>Si eres cajero o empleado</h2>
        <p>Tu usuario lo crea y lo administra el dueño de la droguería. Pídele que te desactive en <b>Equipo</b> dentro de Regenta: tu usuario queda desactivado al instante y ya no puede entrar. Si prefieres pedirlo tú directamente, escríbenos con los datos de abajo.</p>

        <h2 className={h2} style={{ fontWeight: 700 }}>Si eres el dueño de la droguería</h2>
        <ol className="list-decimal pl-6 grid gap-2">
          <li>Antes de nada, descarga tu información: en <b>Equipo → Copia de tus datos</b> bajas un ZIP con productos, inventario, clientes, ventas y documentos electrónicos.</li>
          <li>Escríbenos desde el correo con el que entras a Regenta a <a className="underline" href={`mailto:${CORREO}?subject=${encodeURIComponent("Eliminar mi cuenta de Regenta")}`}>{CORREO}</a> o por <a className="underline" href={wa("Hola, quiero eliminar mi cuenta de Regenta.")}>WhatsApp {TELEFONO}</a>, con el nombre y el NIT de la droguería.</li>
          <li>Comprobamos que eres el titular, cancelamos la renovación automática si la tienes y eliminamos la cuenta. Te confirmamos por correo cuando esté hecho, dentro de los plazos de la Ley 1581 de 2012.</li>
        </ol>

        <h2 className={h2} style={{ fontWeight: 700 }}>Qué se borra</h2>
        <p>Los usuarios y contraseñas de la droguería, el acceso a la consola, los datos de contacto del dueño y del equipo, y los datos personales de los clientes de la droguería que no formen parte de documentos que la ley obliga a conservar.</p>

        <h2 className={h2} style={{ fontWeight: 700 }}>Qué se conserva y por qué</h2>
        <p>Las facturas electrónicas, notas y demás documentos ya enviados a la DIAN, y los registros de pagos de tu plan, se conservan bloqueados durante el tiempo que exige la normativa tributaria y comercial colombiana, solo para atender requerimientos de la DIAN u otras autoridades. Pasado ese tiempo se eliminan. Por eso te recomendamos descargar tu copia antes de pedir la eliminación.</p>

        <p className="text-sm text-muted">Más detalle en la <a className="underline" href="/privacidad">política de tratamiento de datos personales</a>.</p>
      </main>
      <Pie />
    </div>
  );
}
