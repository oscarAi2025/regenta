import { Isotipo } from "@/components/Marca";

/** Portada: una conversación de ejemplo con Regenta IA, que se «responde» una sola vez al cargar. */
export function ChatDemo() {
  return (
    <figure className="w-full max-w-[440px] rounded-3xl bg-surface text-ink shadow-[0_40px_80px_-30px_rgba(0,0,0,.6)] overflow-hidden" aria-label="Ejemplo de conversación con Regenta IA">
      <div className="flex items-center gap-2.5 px-5 h-14 border-b border-line">
        <Isotipo size={26} /><p className="titulo text-lg flex-1">Regenta IA</p><span className="text-xs text-muted">Ejemplo</span>
      </div>
      <div className="p-5 grid gap-3 min-h-[300px] content-start">
        <p className="imprime justify-self-end max-w-[85%] rounded-2xl rounded-br-md bg-ink text-white px-4 py-2.5" style={{ animationDelay: "300ms" }}>¿Qué debo pedir esta semana?</p>
        <div className="relative">
          <p className="pensando absolute text-muted" aria-hidden="true">Consultando tus ventas y lotes…</p>
          <div className="imprime grid gap-2" style={{ animationDelay: "2300ms" }}>
            <p className="leading-relaxed">Con tus ventas de 8 semanas, pide primero:</p>
            <ul className="grid gap-1.5 text-[15px]">
              <li className="flex justify-between gap-3 rounded-lg bg-paper px-3 py-1.5"><span><b>Losartán 50 mg</b> · se agota el jueves</span><span className="num font-semibold">3 cajas</span></li>
              <li className="flex justify-between gap-3 rounded-lg bg-paper px-3 py-1.5"><span><b>Acetaminofén 500</b> · quedan 4 días</span><span className="num font-semibold">2 cajas</span></li>
              <li className="flex justify-between gap-3 rounded-lg bg-paper px-3 py-1.5"><span><b>Suero oral</b> · vende más que antes</span><span className="num font-semibold">12 und</span></li>
            </ul>
            <p className="text-[15px]">Recíbelo antes del sábado: ese día vendes <b className="text-cruz">+27 %</b>.</p>
            <p className="text-xs text-muted">Consultó: pedido sugerido, patrón semanal</p>
          </div>
        </div>
      </div>
    </figure>
  );
}
