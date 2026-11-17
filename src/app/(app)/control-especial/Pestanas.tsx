// Secciones del control especial. Enlaces normales (<a>), como las pestañas de reportes: carga completa con sus filtros.
import { nombreMes } from "@/lib/anexo13";

const PESTANAS = [
  ["/control-especial", "Dispensaciones"], ["/control-especial/libro-completo", "Libro completo"],
  ["/control-especial/anexo-13", "Informe mensual (Anexo 13)"], ["/control-especial/fichas", "Fichas y configuración"],
] as const;

export function Pestanas({ actual }: { actual: (typeof PESTANAS)[number][0] }) {
  return (
    <nav aria-label="Secciones del control especial" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin] -mt-1">
      {PESTANAS.map(([h, t]) => (
        <a key={h} href={h} aria-current={h === actual ? "page" : undefined}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border ${h === actual ? "bg-ink text-white border-ink" : "bg-surface text-muted border-line hover:text-ink"}`}>{t}</a>
      ))}
    </nav>
  );
}

type Plazo = { periodo: string; vence: string; dia: number; diasRestantes: number; vencido: boolean; presentado: boolean } | null;

/** Recordatorio del informe del mes anterior (Res. 1478/2006, art. 94: dentro de los primeros 10 días calendario). */
export function AvisoPlazo({ plazo }: { plazo: Plazo }) {
  if (!plazo || plazo.presentado) return null;
  const vence = plazo.vence.split("-").reverse().join("/");
  const urgente = plazo.vencido || plazo.diasRestantes <= 3;
  return (
    <p role="status" className={`rounded-xl px-4 py-3 text-sm font-semibold ${urgente ? "bg-alerta-soft text-alerta" : "bg-aviso-soft text-aviso"}`}>
      {plazo.vencido
        ? <>El informe de {nombreMes(plazo.periodo)} al Fondo Rotatorio venció el {vence} y no está marcado como presentado. </>
        : <>Informe de {nombreMes(plazo.periodo)} al Fondo Rotatorio: vence el {vence} ({plazo.diasRestantes === 0 ? "hoy" : `quedan ${plazo.diasRestantes} día${plazo.diasRestantes === 1 ? "" : "s"}`}). </>}
      <a href={`/control-especial/anexo-13?mes=${plazo.periodo}`} className="underline underline-offset-4">Generarlo</a>
    </p>
  );
}
