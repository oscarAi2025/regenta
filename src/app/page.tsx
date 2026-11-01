import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/sesion";

export default async function Inicio() {
  redirect((await leerSesion()) ? "/caja" : "/entrar");
}
