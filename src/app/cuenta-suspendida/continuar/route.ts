import { NextResponse } from "next/server";
import { crearSesion, leerSesionConsulta } from "@/lib/sesion";

export const dynamic = "force-dynamic";

/** Ya pagó: la droguería volvió a quedar activa. Cambia la sesión de consulta por una normal y entra a la app. */
export async function GET(req: Request) {
  const s = await leerSesionConsulta();
  const ir = (ruta: string) => new NextResponse(null, { status: 303, headers: { location: ruta } }); // relativa (Netlify)
  if (!s) return ir("/entrar");
  if (!s.activa) return ir("/cuenta-suspendida");
  await crearSesion({ uid: s.uid, empresa: s.empresa, nombre: s.nombre, rol: s.rol });
  void req;
  return ir("/inicio");
}
