import { NextResponse } from "next/server";
import { leerSesion, puede } from "@/lib/sesion";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { mismoOrigen } from "@/lib/api";
import { cajaElegida } from "@/lib/caja-elegida";

/** Números de tiquete POS apartados para esta caja (contingencia, Res. DIAN 165/2023 art. 37; migración 054). La caja los
 *  guarda y, si se queda sin internet, imprime el tiquete con su número definitivo y lo registra con él al volver la red. */
export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const s = await leerSesion();
  if (!s) return NextResponse.json({ error: "Sesión vencida" }, { status: 401 });
  if (!puede.vender(s.rol)) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const r = await comoUsuario(s, async (c) => {
    const puesto = await puestoDeTrabajo(c, s.empresa, await cajaElegida());
    if (!puesto.caja_id) return null;
    const numeros = (await c.query(`select prefijo, numero::int from reservar_contingencia($1, 20)`, [puesto.caja_id])).rows as { prefijo: string; numero: number }[];
    const e = (await c.query(`select coalesce(nullif(razon_social, ''), nombre_comercial) razon, nit, dv from empresas where id = $1`, [s.empresa])).rows[0];
    return { caja: puesto.caja_id, numeros, emisor: e ? { razon: e.razon, nit: `${e.nit}${e.dv ? "-" + e.dv : ""}` } : null };
  });
  if (!r) return NextResponse.json({ error: "Sin caja" }, { status: 409 });
  return NextResponse.json(r);
}
