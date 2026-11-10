"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";

const marca = () => document.querySelector("[data-render]")?.getAttribute("data-render") ?? null;
const esperar = (cond: () => boolean, ms: number) => new Promise<boolean>((fin) => {
  if (cond()) return fin(true);
  const t0 = Date.now();
  const id = setInterval(() => { if (cond()) { clearInterval(id); fin(true); } else if (Date.now() - t0 > ms) { clearInterval(id); fin(false); } }, 50);
});

/** Refresca los datos del servidor y comprueba que la pantalla de verdad cambió. Next.js 15 a veces recibe la respuesta
 *  de router.refresh() y no la aplica (medido: 2 de 20 tras guardar un ajuste): se reintenta, y como último recurso se
 *  recarga la página. Devuelve una promesa que se cumple cuando la pantalla ya muestra los datos nuevos. */
export function useRefrescar() {
  const router = useRouter();
  return useCallback(async () => {
    const antes = marca();
    if (antes === null) { router.refresh(); return; } // pantalla sin marca: refresco normal
    for (let intento = 0; intento < 3; intento++) {
      router.refresh();
      if (await esperar(() => marca() !== antes, intento === 0 ? 4000 : 6000)) return;
    }
    window.location.reload();
  }, [router]);
}
