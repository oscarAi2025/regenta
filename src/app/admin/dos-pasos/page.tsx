import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { Marca } from "@/components/Marca";
import { exigirAdmin } from "@/lib/admin-pagina";
import { sinRLS } from "@/lib/db";
import { cifrar, descifrar, dosPasosActivos, nuevoSecretoTotp } from "@/lib/totp";
import { ActivarDosPasos } from "./ActivarDosPasos";

export const metadata: Metadata = { title: "Verificación en dos pasos", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// La consola da acceso a todas las droguerías: además de la contraseña pide el código de 6 cifras de una app de
// autenticación. Esta página la activa (y es la única que se puede abrir hasta hacerlo).
export default async function DosPasos() {
  const a = await exigirAdmin({ inscribir: true });
  if (!dosPasosActivos()) redirect("/admin"); // apagados: la consola entra con correo y contraseña
  const cuenta = (await sinRLS((c) => c.query(`select email, totp_secreto, totp_pendiente from cuentas where id = $1`, [a.uid]))).rows[0];
  const activa = !!cuenta?.totp_secreto;
  let clave = "", qr = "";
  if (!activa) {
    // La clave pendiente se conserva entre recargas (si ya la escaneó, sigue sirviendo) hasta que se confirma.
    clave = cuenta?.totp_pendiente ? descifrar(cuenta.totp_pendiente) : nuevoSecretoTotp();
    if (!cuenta?.totp_pendiente) await sinRLS((c) => c.query(`update cuentas set totp_pendiente = $2 where id = $1`, [a.uid, cifrar(clave)]));
    const url = `otpauth://totp/${encodeURIComponent(`Regenta:${cuenta?.email ?? "consola"}`)}?secret=${clave}&issuer=Regenta&algorithm=SHA1&digits=6&period=30`;
    qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
  }
  return (
    <main className="min-h-screen grid place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-md tarjeta p-6 sm:p-8 grid gap-4">
        <Marca />
        <h1 className="font-cond text-[32px] leading-tight" style={{ fontWeight: 700 }}>Verificación en dos pasos</h1>
        {activa ? <p className="text-muted">Ya está activa: cada vez que entres a la consola te pediremos el código de tu app de autenticación.</p> : <>
          <p className="text-muted">La consola da acceso a todas las droguerías. Para entrar, además de tu contraseña, te pediremos el código de 6 cifras de una app de autenticación (Google Authenticator, Microsoft Authenticator o 1Password).</p>
          <ol className="grid gap-3 list-decimal pl-5">
            <li>Abre la app en tu teléfono y escanea este código:
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Código QR para la app de autenticación" width={200} height={200} className="mt-2 rounded-lg border border-line" />
              <p className="mt-2 text-sm text-muted">¿No puedes escanearlo? Escribe esta clave en la app: <code data-clave className="font-mono break-all text-ink">{clave}</code></p>
            </li>
            <li>Escribe el código de 6 cifras que muestra la app.</li>
          </ol>
          <ActivarDosPasos />
        </>}
      </div>
    </main>
  );
}
