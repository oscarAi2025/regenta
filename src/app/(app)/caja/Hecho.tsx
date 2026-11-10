"use client";
import { pesos } from "@/lib/formato";
import { imprimirFactura, imprimirTiquete, imprimirVenta, type Impresora } from "@/lib/impresion";
import { imprimirProvisional } from "@/lib/sin-conexion";
import type { Resultado } from "./tipos";

const fechaCorta = (f: string) => new Date(f + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

/** La tirilla después de cobrar: número, total, cambio, estado DIAN, imprimir y venta nueva. */
export function Hecho({ hecho, control, impresora, cambiarImpresora, nombreEmpresa, nueva, pedido }: {
  hecho: Resultado; control: boolean; impresora: Impresora; cambiarImpresora: (i: Impresora) => void; nombreEmpresa: string; nueva: () => void; pedido: string | null;
}) {
  const esFactura = !hecho.provisional && (hecho.documento?.tipo ?? hecho.tipo) === "factura";
  return (
    <div className="px-6 pt-6">
      {hecho.provisional ? <>
        <p className="text-sm text-aviso font-semibold">Venta guardada sin internet</p>
        <p className="font-cond text-2xl num" style={{ fontWeight: 700 }}>Comprobante provisional</p>
        <p className="mt-2 text-sm text-muted">Se registra y se envía a la DIAN sola en cuanto vuelva internet. No la cobres de nuevo.</p>
      </> : <>
        <p className="text-sm text-muted">{hecho.documento?.tipo === "factura" ? "Factura electrónica registrada" : "Venta registrada"}</p>
        <p className="font-cond text-2xl num" style={{ fontWeight: 700 }}>{hecho.venta.prefijo}{hecho.venta.numero}</p>
        {pedido && <p className="mt-1 text-sm font-semibold text-cruz">{pedido} quedó cobrado</p>}
      </>}
      <div className="corte my-5" />
      <div className="flex items-baseline justify-between"><span>Total</span><span className="num font-cond text-2xl" style={{ fontWeight: 700 }}>{pesos(hecho.venta.total)}</span></div>
      {hecho.venta.repetida && (
        <p role="alert" className="mt-4 rounded-xl bg-alerta-soft text-alerta px-4 py-3 font-semibold">Esta venta ya se había registrado antes del corte de conexión. Revisa la tirilla: si agregaste productos después, no se cobraron; regístralos en una venta nueva.</p>
      )}
      {!hecho.provisional && control && (
        <p className="mt-4 rounded-xl bg-paper px-4 py-3 text-sm"><b>Control especial:</b> la dispensación quedó en el libro con el lote vendido, el paciente y la fórmula.</p>
      )}
      {hecho.venta.credito && hecho.venta.vence_pago && (
        <p className="mt-4 rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold">A crédito · vence el {fechaCorta(hecho.venta.vence_pago)}. Queda en Cartera para registrar los abonos.</p>
      )}
      {Number(hecho.venta.cambio) > 0 && (
        <div className="mt-4 rounded-xl bg-cruz text-cruz-ink px-5 py-4 flex items-baseline justify-between">
          <span className="text-lg">Cambio</span><span className="num font-cond text-[44px] leading-none" style={{ fontWeight: 700 }}>{pesos(hecho.venta.cambio)}</span>
        </div>
      )}
      {!hecho.provisional && <div className="mt-5 flex items-center gap-2 text-sm">
        <span className={`size-2.5 rounded-full ${hecho.documento?.estado === "aceptado" ? "bg-cruz" : hecho.documento?.estado === "rechazado" ? "bg-alerta" : "bg-aviso"}`} />
        <span>
          {hecho.documento?.estado === "aceptado" ? (hecho.documento.tipo === "factura" ? "Factura electrónica aceptada" : "Tiquete POS electrónico aceptado") : hecho.documento?.estado === "rechazado" ? `DIAN rechazó el documento: ${hecho.documento.ultimo_error}` : "Enviando a la DIAN: la cola lo reintenta sola"}
          {hecho.documento?.simulado && <span className="text-muted"> · emisión simulada (pruebas)</span>}
        </span>
      </div>}
      {hecho.documento?.cufe && <p className="mt-2 text-[11px] text-muted break-all font-cond">{hecho.documento.tipo === "factura" ? "CUFE" : "CUDE"} {hecho.documento.cufe}</p>}
      <div className="mt-6 grid grid-cols-[auto_1fr] gap-2">
        <button onClick={() => hecho.provisional ? imprimirProvisional(hecho.provisional, nombreEmpresa, impresora.ancho) : imprimirVenta(hecho.venta.venta_id, hecho.documento?.tipo ?? hecho.tipo, impresora)} className="h-14 px-4 rounded-xl border border-line font-semibold">
          {esFactura ? (impresora.factura === "carta" ? "Imprimir factura" : "Imprimir tirilla") : "Imprimir"} <kbd className="ml-1">F8</kbd></button>
        <button onClick={nueva} className="h-14 rounded-xl bg-ink text-white text-lg font-semibold">Nueva venta <kbd className="ml-2 !bg-transparent !text-white/70 !border-white/30">Enter</kbd></button>
      </div>
      {esFactura && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {impresora.factura === "carta"
            ? <button type="button" onClick={() => imprimirTiquete(hecho.venta.venta_id, impresora.ancho)} className="underline font-semibold">Imprimir también la tirilla</button>
            : <button type="button" onClick={() => imprimirFactura(hecho.venta.venta_id)} className="underline font-semibold">Imprimir la factura en tamaño carta</button>}
          <a href={`/tiquete/factura/${hecho.venta.venta_id}`} target="_blank" rel="noopener" className="underline font-semibold">Ver la factura</a>
        </p>
      )}
      <details className="mt-3 text-sm text-muted">
        <summary className="cursor-pointer">Impresora de esta caja</summary>
        <div className="mt-2 grid gap-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={impresora.auto} onChange={(e) => cambiarImpresora({ ...impresora, auto: e.target.checked })} /> Imprimir al cobrar</label>
          <label className="flex items-center gap-2">Facturas electrónicas
            <select className="campo !h-9 !w-auto" value={impresora.factura} onChange={(e) => cambiarImpresora({ ...impresora, factura: e.target.value as Impresora["factura"] })}>
              <option value="carta">Tamaño carta (con logo y datos completos)</option><option value="tirilla">Tirilla de la térmica</option>
            </select>
          </label>
          <label className="flex items-center gap-2">Papel de la tirilla
            <select className="campo !h-9 !w-auto" value={impresora.ancho} onChange={(e) => cambiarImpresora({ ...impresora, ancho: e.target.value as Impresora["ancho"] })}>
              <option value="80">80 mm</option><option value="58">58 mm</option>
            </select>
          </label>
          <p>Para que salga sin el cuadro de impresión, abre la caja con un acceso directo de Chrome que tenga <span className="font-mono">--kiosk-printing</span> y deja la térmica como impresora predeterminada. El cajón monedero se abre con la opción «abrir cajón al imprimir» del controlador de la impresora.</p>
        </div>
      </details>
    </div>
  );
}
