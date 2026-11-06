"use client";
import { TIPOS_DOC_PACIENTE, hoyBogota, restarDias, type ConfigFormula, type DatosFormula, type Exigencia } from "@/lib/control-especial";

/** Fórmula médica de la venta: para control especial (o si la droguería lo exige) pide paciente, médico y fórmula; para
 *  los demás productos con fórmula, la confirmación de que se verificó. La caja no cobra hasta que esté completo. */
export function PanelFormula({ ex, cfg, datos, onCambio, falta, sinRed }: {
  ex: Exigencia; cfg: ConfigFormula; datos: DatosFormula; onCambio: (d: DatosFormula) => void; falta: string | null; sinRed: boolean;
}) {
  const control = ex.control.length > 0;
  const set = <K extends keyof DatosFormula>(k: K, v: DatosFormula[K]) => onCambio({ ...datos, [k]: v });
  const hoy = hoyBogota();
  const nombres = [...ex.control, ...ex.formula];
  return (
    <section id="formula" aria-labelledby="formula-titulo" className={`mx-4 sm:mx-6 mt-3 mb-3 rounded-xl border-2 bg-surface p-4 scroll-mt-20 ${control ? "border-alerta/50" : "border-aviso/50"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${control ? "bg-alerta-soft text-alerta" : "bg-aviso-soft text-aviso"}`}>
          {control ? "Control especial" : "Requiere fórmula médica"}
        </span>
        <h3 id="formula-titulo" className="font-semibold leading-tight">{ex.datos ? "Datos de la fórmula médica" : "Requiere fórmula médica"}</h3>
      </div>
      <p className="mt-1 text-sm text-muted">{nombres.length === 1 ? nombres[0] : `${nombres.length} productos: ${nombres.join(" · ")}`}</p>
      {ex.datos && nombres.length > 1 && <p className="mt-1 text-[13px] text-muted">Los datos se registran para todos estos productos: si vienen en fórmulas distintas, haz una venta por fórmula.</p>}

      {ex.datos ? (
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
          <div className="col-span-2 grid grid-cols-[5.5rem_1fr] gap-2">
            <div>
              <label htmlFor="f-tdoc" className="etiqueta !mb-1">Documento</label>
              <select id="f-tdoc" className="campo !h-10 !px-2" value={datos.paciente_tipo_doc} onChange={(e) => set("paciente_tipo_doc", e.target.value)}
                aria-describedby="f-tdoc-nombre">
                {TIPOS_DOC_PACIENTE.map(([k]) => <option key={k} value={k}>{k}</option>)}
              </select>
              <span id="f-tdoc-nombre" className="sr-only">{TIPOS_DOC_PACIENTE.find(([k]) => k === datos.paciente_tipo_doc)?.[1]}</span>
            </div>
            <div>
              <label htmlFor="f-doc" className="etiqueta !mb-1">Número del paciente</label>
              <input id="f-doc" className="campo !h-10 num" inputMode="text" autoComplete="off" value={datos.paciente_doc} onChange={(e) => set("paciente_doc", e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="col-span-2">
            <label htmlFor="f-paciente" className="etiqueta !mb-1">Nombre del paciente</label>
            <input id="f-paciente" className="campo !h-10" autoComplete="off" value={datos.paciente_nombre} onChange={(e) => set("paciente_nombre", e.target.value)} />
          </div>
          <div className="col-span-2 sm:col-span-1 xl:col-span-2">
            <label htmlFor="f-medico" className="etiqueta !mb-1">Médico que formula</label>
            <input id="f-medico" className="campo !h-10" autoComplete="off" value={datos.medico_nombre} onChange={(e) => set("medico_nombre", e.target.value)} />
          </div>
          <div className="col-span-2 sm:col-span-1 xl:col-span-2">
            <label htmlFor="f-registro" className="etiqueta !mb-1">Registro profesional</label>
            <input id="f-registro" className="campo !h-10" autoComplete="off" value={datos.medico_registro} onChange={(e) => set("medico_registro", e.target.value.toUpperCase())} />
          </div>
          <div>
            <label htmlFor="f-numero" className="etiqueta !mb-1">N.º de fórmula</label>
            <input id="f-numero" className="campo !h-10" autoComplete="off" value={datos.formula_numero} onChange={(e) => set("formula_numero", e.target.value.toUpperCase())} />
          </div>
          <div>
            <label htmlFor="f-fecha" className="etiqueta !mb-1">Fecha de la fórmula</label>
            <input id="f-fecha" type="date" className="campo !h-10 !px-2 num" max={hoy} min={control ? restarDias(hoy, cfg.vigencia_dias) : undefined}
              value={datos.formula_fecha} onChange={(e) => set("formula_fecha", e.target.value)} aria-describedby={control ? "f-vigencia" : undefined} />
          </div>
          {control && <p id="f-vigencia" className="col-span-2 text-[13px] text-muted">Se acepta la fórmula de los últimos {cfg.vigencia_dias} días (plazo configurado por tu droguería).</p>}
        </div>
      ) : (
        <label className="mt-3 flex items-start gap-3 cursor-pointer rounded-lg bg-aviso-soft/60 p-3">
          <input id="f-verificada" type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--cruz)]" checked={datos.verificada} onChange={(e) => set("verificada", e.target.checked)} />
          <span className="text-[15px] font-semibold leading-snug">Verifiqué la fórmula médica del paciente</span>
        </label>
      )}

      {sinRed ? (
        <p role="alert" className="mt-3 rounded-lg bg-alerta-soft px-3 py-2 text-sm font-semibold text-alerta">
          Sin internet no se puede registrar esta fórmula. Quita {nombres.length === 1 ? "este producto" : "estos productos"} de la venta o espera a que vuelva la conexión.
        </p>
      ) : (
        <p aria-live="polite" className={`mt-3 text-sm ${falta ? "text-muted" : "font-semibold text-cruz"}`}>
          {falta ? `Para cobrar: ${falta.charAt(0).toLowerCase()}${falta.slice(1)}.` : ex.datos ? "Fórmula completa: queda registrada con la venta." : "Fórmula verificada."}
        </p>
      )}
    </section>
  );
}
