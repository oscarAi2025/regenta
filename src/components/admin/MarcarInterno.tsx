"use client";
import { useEffect } from "react";
import { marcarInterno } from "@/components/MedirWeb";

/** Quien entra a la consola es del equipo: su navegador deja de contar en el embudo de la web y en las visitas a la demo. */
export function MarcarInterno() {
  useEffect(() => { marcarInterno(true); }, []);
  return null;
}
