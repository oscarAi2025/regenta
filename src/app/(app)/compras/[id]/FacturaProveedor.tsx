"use client";
import { useRef, useState } from "react";
import type { ArchivoCompra } from "@/lib/compra-archivo";

// La factura original del proveedor en la compra: verla (PDF o foto), descargarla y, si la compra se registró a mano,
// adjuntarla después. La bodega solo adjunta; ver el archivo es del dueño y el administrador.

const peso = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const TIPO: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "Foto", "image/png": "Foto", "image/webp": "Foto", "application/zip": "ZIP de la DIAN", "application/xml": "XML de la DIAN" };
const enPantalla = (t: string) => t === "application/pdf" || t.startsWith("image/");

export function FacturaProveedor({ compraId, inicial, verArchivos, anulada }: { compraId: string; inicial: ArchivoCompra[]; verArchivos: boolean; anulada: boolean }) {
  const [archivos, setArchivos] = useState(inicial);
  const [estado, setEstado] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const url = (a: ArchivoCompra, descargar = false) => `/api/compras/${compraId}/factura?archivo=${a.id}${descargar ? "&descargar=1" : ""}`;

  async function subir(f: File | undefined) {
    if (!f) return;
    setSubiendo(true); setEstado(null);
    try {
      const fd = new FormData(); fd.append("archivo", f);
      const r = await fetch(`/api/compras/${compraId}/factura`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setEstado({ tipo: "error", texto: j.error ?? "No se pudo adjuntar la factura" });
      else { if (verArchivos) setArchivos(j.archivos ?? []); setEstado({ tipo: "ok", texto: "Factura adjunta a la compra" }); }
    } catch { setEstado({ tipo: "error", texto: "Sin conexión: revisa internet y vuelve a intentar." }); }
    setSubiendo(false);
    if (input.current) input.current.value = "";
  }

  const primera = archivos.find((a) => enPantalla(a.tipo));
  return (
    <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="factura-proveedor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="factura-proveedor" className="text-lg font-bold">Factura del proveedor</h2>
        {!anulada && (
          <label className={`btn-borde cursor-pointer ${subiendo ? "opacity-60 pointer-events-none" : ""}`}>
            {subiendo ? "Subiendo…" : archivos.length ? "Adjuntar otro archivo" : "Adjuntar la factura"}
            <input ref={input} type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.webp,.zip,.xml,application/pdf,image/*"
              onChange={(e) => subir(e.target.files?.[0])} disabled={subiendo} />
          </label>
        )}
      </div>
      {estado && <p role="status" className={`rounded-lg px-3 py-2 text-sm font-semibold ${estado.tipo === "ok" ? "bg-cruz-soft text-cruz" : "bg-alerta-soft text-alerta"}`}>{estado.texto}</p>}
      {verArchivos && archivos.length === 0 && (
        <p className="text-muted">Esta compra se registró sin la factura. Adjunta el PDF, una foto o el ZIP que llegó al correo para tener el soporte aquí.</p>
      )}
      {!verArchivos && archivos.length === 0 && <p className="text-muted">Adjunta el PDF o una foto de la factura que llegó con la mercancía.</p>}
      {archivos.length > 0 && (
        <ul className="grid gap-2">
          {archivos.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
              <span className="min-w-0">
                <span className="block font-semibold truncate">{a.nombre}</span>
                <span className="text-sm text-muted num">{TIPO[a.tipo] ?? "Archivo"} · {peso(a.tamano)} · {a.creado}{a.usuario ? ` · ${a.usuario}` : ""}</span>
              </span>
              <span className="flex gap-2">
                {enPantalla(a.tipo) && <a href={url(a)} target="_blank" rel="noopener noreferrer" className="btn-borde">Ver</a>}
                <a href={url(a, true)} download className="btn-borde">Descargar</a>
              </span>
            </li>
          ))}
        </ul>
      )}
      {primera && primera.tipo === "application/pdf" && (
        <iframe src={url(primera)} title={`Factura ${primera.nombre}`} className="w-full h-[70vh] rounded-xl border border-line bg-paper" />
      )}
      {primera && primera.tipo.startsWith("image/") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url(primera)} alt={`Factura ${primera.nombre}`} className="w-full max-h-[80vh] object-contain rounded-xl border border-line bg-paper" />
      )}
    </section>
  );
}
