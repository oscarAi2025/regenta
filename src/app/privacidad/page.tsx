import type { Metadata } from "next";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { metaPublica } from "@/lib/seo";
import { CORREO, TELEFONO } from "@/lib/sitio";

export const metadata: Metadata = metaPublica("/privacidad", "Política de tratamiento de datos personales | Regenta", "Cómo trata Regenta, de Farmagenéricos Colombia, los datos personales de clientes y usuarios conforme a la Ley 1581 de 2012.");

export default function Privacidad() {
  return (
    <div className="bg-paper text-ink min-h-screen">
      <CabeceraPublica />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 grid gap-5 text-[17px] leading-relaxed">
        <h1 className="font-cond text-[40px] sm:text-[52px] leading-[1]" style={{ fontWeight: 700 }}>Política de tratamiento de datos personales</h1>
        <p><b>Responsable:</b> IA DEV INVESTIMENTS COLOMBIA S.A.S., NIT 901.845.370-5, propietaria del establecimiento Farmagenéricos Colombia y de Regenta, Ibagué, Tolima. Contacto: {CORREO} · {TELEFONO}.</p>
        <h2 className="font-cond text-3xl" style={{ fontWeight: 700 }}>Qué datos y para qué</h2>
        <p>Los datos que nos das al pedir una demostración o contratar (nombre, empresa, NIT o cédula, correo y celular) se usan para contactarte, activar y facturar tu plan y darte soporte. Los pagos con tarjeta los procesa la pasarela (Stripe) y los pagos con QR se hacen desde la app de tu banco a la cuenta de la empresa: Regenta no recibe ni guarda los datos de tu tarjeta o tu cuenta bancaria.</p>
        <p>Los datos que cada droguería registra en Regenta (sus clientes, ventas e inventario) son de esa droguería: Regenta los guarda y procesa por encargo suyo, y cada empresa solo puede ver los propios. Para prestar el servicio nos apoyamos en encargados: el alojamiento de la base de datos y del sitio, y el servicio que transmite los documentos electrónicos a la DIAN, que solo los usan para ese fin.</p>
        <h2 className="font-cond text-3xl" style={{ fontWeight: 700 }}>Correos</h2>
        <p>Te escribimos por correo lo necesario para tu cuenta: activación, bienvenida, pagos y avisos de renovación. Los correos con consejos y novedades solo los recibes si marcaste la casilla que lo autoriza; guardamos el texto que aceptaste, la fecha y la dirección IP como prueba. Cada uno trae un enlace para darte de baja con un clic, y la baja se aplica de inmediato. Los correos se envían desde nuestro buzón de Google Workspace; Google actúa como encargado y solo los usa para entregarlos.</p>
        <h2 className="font-cond text-3xl" style={{ fontWeight: 700 }}>Tus derechos</h2>
        <p>Como titular puedes conocer, actualizar, rectificar y pedir la supresión de tus datos, revocar la autorización y pedir prueba de ella, conforme a la Ley 1581 de 2012. Escríbenos a {CORREO} y te respondemos dentro de los plazos de ley.</p>
      </main>
      <Pie />
    </div>
  );
}
