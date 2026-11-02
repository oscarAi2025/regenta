import type { Metadata } from "next";
import Link from "next/link";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { metaPublica } from "@/lib/seo";
import { CORREO, TELEFONO } from "@/lib/sitio";
import { DOC_EXTRA, PLANES } from "@/lib/planes";

export const metadata: Metadata = metaPublica("/terminos", "Términos y condiciones del servicio | Regenta", "Condiciones de uso de Regenta, software de facturación electrónica y gestión para droguerías: planes, pagos, factura electrónica, datos y soporte.");

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="font-cond text-3xl mt-4" style={{ fontWeight: 700 }}>{children}</h2>;
const pesos = (n: number) => "$" + n.toLocaleString("es-CO");

export default function Terminos() {
  const [esencial, pro] = PLANES;
  return (
    <div className="bg-paper text-ink min-h-screen">
      <CabeceraPublica />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 grid gap-4 text-[17px] leading-relaxed">
        <h1 className="font-cond text-[40px] sm:text-[52px] leading-[1]" style={{ fontWeight: 700 }}>Términos y condiciones del servicio</h1>
        <p className="text-muted">Vigentes desde el 2 de noviembre de 2026.</p>

        <H2>1. Quiénes somos y qué contratas</H2>
        <p>Regenta es un software en la nube de facturación electrónica, punto de venta e inventario para droguerías y farmacias, de <b>IA DEV INVESTIMENTS COLOMBIA S.A.S.</b>, NIT 901.845.370-5, Ibagué, Tolima («Regenta»). Al contratar o usar Regenta, la droguería o persona que lo contrata («el cliente») acepta estos términos.</p>

        <H2>2. Planes y precios</H2>
        <p>Los planes y lo que incluye cada uno son los publicados en <Link href="/precios" className="underline">Tarifas</Link> en el momento de contratar: {esencial.nombre} {pesos(esencial.precio)} al mes y {pro.nombre} {pesos(pro.precio)} al mes. Pagando el año completo, el cliente recibe dos meses gratis. Los documentos electrónicos que superen el cupo mensual del plan se cobran a {pesos(DOC_EXTRA)} cada uno. Si los precios cambian, avisamos con al menos 30 días de anticipación y el cambio se aplica desde el siguiente periodo.</p>

        <H2>3. Pagos, renovación y cancelación</H2>
        <p>El servicio se paga por anticipado, mensual o anual. Con tarjeta, la suscripción se renueva sola al final de cada periodo. Con el QR de la cuenta empresarial, el cliente paga cada periodo y le enviamos recordatorios antes del vencimiento. No hay permanencia: el cliente puede cancelar cuando quiera y conserva el servicio hasta el final del periodo pagado; no se hacen reembolsos de periodos ya iniciados. Si un pago no llega, avisamos al cliente y, si no se pone al día, Regenta puede suspender el servicio hasta que pague; sus datos se conservan.</p>

        <H2>4. Factura electrónica</H2>
        <p>El cliente es el facturador electrónico ante la DIAN: emite sus documentos con su NIT, su resolución de numeración y su certificado de firma, habilitado ante la DIAN como software propio por medio del servicio de facturación que integra Regenta. Regenta gestiona la habilitación y el certificado digital incluidos en el plan, y transmite los documentos a la DIAN. El cliente responde por la veracidad de los datos que registra (precios, impuestos, clientes) y por sus obligaciones tributarias; Regenta responde por el funcionamiento del software. Mientras la habilitación no esté terminada, los documentos de prueba no tienen validez fiscal y así se indica en cada uno.</p>

        <H2>5. Datos del cliente</H2>
        <p>La información que el cliente registra en Regenta (ventas, inventario, clientes y proveedores) es suya. Regenta la guarda y la procesa solo por encargo del cliente y para prestar el servicio, conforme a la Ley 1581 de 2012 y a nuestra <Link href="/privacidad" className="underline">política de datos</Link>. Al aceptar estos términos, el cliente autoriza a Regenta a tratar esos datos como encargado y a apoyarse en los proveedores necesarios para operar el servicio (alojamiento de la base de datos, transmisión de documentos electrónicos y envío de correos), que actúan a su vez como encargados. El cliente declara que cuenta con la autorización de sus propios clientes para registrar sus datos. Al terminar el servicio, el cliente puede pedir una copia de su información durante los 60 días siguientes.</p>

        <H2>6. Uso adecuado</H2>
        <p>El cliente se compromete a usar Regenta solo para su actividad legal, a cuidar las contraseñas de sus usuarios y a no intentar acceder a datos de otras empresas. Cada usuario entra con su propia cuenta; el cliente define sus roles y responde por lo que hagan sus usuarios.</p>

        <H2>7. Disponibilidad y soporte</H2>
        <p>Regenta funciona en la nube y procura estar disponible siempre. Pueden darse interrupciones por mantenimiento o por fallas de terceros (internet, la DIAN o los proveedores de nube); si la DIAN no responde, los documentos quedan en cola y se envían solos cuando vuelve. El soporte se presta por WhatsApp y correo en horario hábil de Colombia.</p>

        <H2>8. Responsabilidad</H2>
        <p>Regenta no responde por pérdidas indirectas, lucro cesante ni decisiones comerciales tomadas con base en los reportes, predicciones o respuestas del asistente de inteligencia artificial, que son una ayuda y no reemplazan el criterio del regente o del dueño. En todo caso, la responsabilidad total de Regenta frente al cliente se limita a lo que el cliente pagó en los últimos tres meses.</p>

        <H2>9. Propiedad intelectual</H2>
        <p>El software, la marca Regenta y sus contenidos son de IA DEV INVESTIMENTS COLOMBIA S.A.S. El cliente recibe una licencia de uso mientras su plan esté vigente; no puede copiar, revender ni ceder el software.</p>

        <H2>10. Cambios, ley aplicable y contacto</H2>
        <p>Podemos actualizar estos términos; los cambios importantes se avisan por correo con al menos 30 días de anticipación. Se rigen por la ley colombiana. Para cualquier duda o reclamo: {CORREO} · {TELEFONO}.</p>
      </main>
      <Pie />
    </div>
  );
}
