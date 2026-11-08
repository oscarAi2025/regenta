"use client";
import { useRef, useState } from "react";

// «Cargar desde la factura»: el ZIP o XML que llega al correo (lectura exacta) o una foto/PDF (Regenta IA).
// Las fotos se achican en el teléfono antes de subirlas: llegan más rápido y se leen igual de bien.

export type ProductoFactura = { id: string; nombre: string; laboratorio: string | null; ean: string | null; unidades_por_caja: number; unidades: number; iva: number; precio_caja: number; precio_unidad: number | null };
export type LineaFactura = {
  n: number; codigo: string | null; descripcion: string; nombre: string; cantidad: number; precio: number | null; descuento_pct: number; iva_pct: number;
  lote: string | null; vence: string | null; bonificada: boolean; producto: ProductoFactura | null; por: "codigo" | "memoria" | "nombre" | null;
  como: "caja" | "unidad"; revisar_como: boolean; candidatos: (ProductoFactura & { puntaje: number })[]; claves: string[];
};
export type FacturaCargada = {
  documento: { tipo: string; numero: string; fecha: string | null; cufe: string | null; vence_pago: string | null; origen: "xml" | "ia";
    proveedor: { nombre: string; nit: string | null }; lineas: LineaFactura[]; totales: { total: number | null } };
  proveedor: { id: string; nombre: string; nit: string | null; plazo_dias: number | null } | null;
  archivo_id: string | null; duplicada: { id: string; numero: number } | null; avisos: string[];
  resumen: { lineas: number; emparejadas: number; con_lote: number };
};

async function achicar(f: File): Promise<Blob> {
  if (!f.type.startsWith("image/") || f.size < 1_200_000) return f;
  try {
    const img = await createImageBitmap(f, { imageOrientation: "from-image" });
    const k = Math.min(1, 2200 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
    const b = await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/jpeg", 0.85));
    return b && b.size < f.size ? b : f;
  } catch { return f; }
}

export function CargarFactura({ alCargar }: { alCargar: (r: FacturaCargada) => void }) {
  const [estado, setEstado] = useState<"" | "subiendo" | "leyendo">("");
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState(true);
  const archivo = useRef<HTMLInputElement>(null), camara = useRef<HTMLInputElement>(null);

  async function subir(f: File | undefined) {
    if (!f) return;
    setError(""); setEstado("subiendo");
    const esFoto = f.type.startsWith("image/") || /\.pdf$/i.test(f.name);
    const fd = new FormData();
    const datos = await achicar(f);
    fd.append("archivo", datos, datos === f ? f.name : f.name.replace(/\.\w+$/, "") + ".jpg");
    setEstado("leyendo");
    let r: Response;
    try { r = await fetch("/api/compras/leer-factura", { method: "POST", body: fd }); }
    catch { setEstado(""); setError("Sin conexión: revisa internet y vuelve a intentarlo."); return; }
    const j = await r.json().catch(() => ({}));
    setEstado("");
    if (!r.ok) { setError(j.error ?? (esFoto ? "No se pudo leer la foto. Tómala de frente, con buena luz." : "No se pudo leer la factura.")); return; }
    setAbierta(false);
    alCargar(j as FacturaCargada);
  }

  const ocupado = estado !== "";
  return (
    <section className="tarjeta p-4 sm:p-5 grid gap-3 border-2 border-dashed border-cruz/40" aria-labelledby="cargar-t" aria-busy={ocupado}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cargar-t" className="titulo text-xl">Cargar desde la factura</h2>
        {!abierta && !ocupado && <button type="button" onClick={() => setAbierta(true)} className="text-sm font-semibold text-cruz underline">Cargar otra</button>}
      </div>
      {abierta && <>
        <p className="text-muted">Sube el <b className="text-ink">ZIP o XML</b> que te llegó al correo y la compra se arma sola: proveedor, productos, lotes, vencimientos, cantidades y costos. ¿Solo tienes el papel? Tómale una <b className="text-ink">foto</b>. Tú revisas antes de guardar.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={ocupado} onClick={() => archivo.current?.click()} className="btn-primario">Subir ZIP, XML o PDF</button>
          <button type="button" disabled={ocupado} onClick={() => camara.current?.click()} className="btn-borde">Tomar foto de la factura</button>
        </div>
        <input ref={archivo} type="file" accept=".zip,.xml,.pdf,application/zip,application/xml,text/xml,application/pdf,image/*" className="sr-only" aria-label="Archivo de la factura"
          onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={camara} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Foto de la factura"
          onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = ""; }} />
      </>}
      {ocupado && <p role="status" className="font-semibold text-cruz">{estado === "subiendo" ? "Preparando el archivo…" : "Leyendo la factura y buscando cada producto en tu catálogo…"}</p>}
      {error && <p role="alert" className="rounded-xl bg-alerta-soft text-alerta px-4 py-3 font-semibold">{error}</p>}
    </section>
  );
}
