"use client";
/** Botón que abre Regenta IA con una pregunta ya escrita. */
export function PreguntarIA({ pregunta, texto = "Pregúntale a Regenta IA" }: { pregunta: string; texto?: string }) {
  return <button onClick={() => window.dispatchEvent(new CustomEvent("regenta-ia", { detail: pregunta }))} className="btn bg-white text-ink hover:brightness-95 h-12">{texto}</button>;
}
