import { randomUUID } from "node:crypto";

/** Marca de cada render del servidor. `useRefrescar` la compara para saber si un router.refresh() llegó a la pantalla
 *  (Next.js 15 a veces recibe la respuesta y no la aplica: ver tasks/lessons.md, «refrescos que no llegan»). */
export function MarcaRender() {
  return <span hidden data-render={randomUUID()} />;
}
