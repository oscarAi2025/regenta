// Venta sin internet (la caja nunca se detiene): el catálogo de la droguería se guarda en este navegador para buscar
// sin conexión, la venta se encola con su clave de idempotencia y se envía sola al volver internet (la base no la
// duplica aunque llegue dos veces). Mientras tanto se entrega un comprobante provisional; el tiquete POS electrónico
// se emite al registrarse. Solo ventas POS de contado: la factura a crédito necesita la cartera en línea.

export type ProductoCaja = {
  id: string; nombre: string; laboratorio: string | null; ean: string | null; iva: number; unidades_por_caja: number;
  precio_caja: number; precio_unidad: number | null; stock_minimo: number; unidades: number; proximo_vence: string | null; exacto: boolean;
  requiere_formula?: boolean; control_especial?: boolean;
  /** Códigos de barras alternos (además del ean): el lector los encuentra igual sin internet. */
  codigos?: string[];
};
export type VentaEnCola = {
  idem_key: string; empresa: string; creado: string; cuerpo: Record<string, unknown>; total: number; cambio: number;
  lineas: { nombre: string; cantidad: number; presentacion: "caja" | "unidad"; total: number; producto_id: string; unidades: number }[];
  error?: string;
  aviso?: string; // error pasajero: se reintenta sola
};

const K_CATALOGO = "regenta.catalogo";
// Versión del catálogo guardado: la 2 trae las marcas de fórmula médica y control especial. Un catálogo anterior no se usa
// (sin esas marcas, la caja podría vender sin internet un medicamento que exige registrar la fórmula). La 3 trae los códigos
// alternos de cada producto (sin ellos, escanear un código alterno sin internet no encontraría el producto).
const V_CATALOGO = 3;
const K_COLA = "regenta.cola_ventas";
const leer = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const escribir = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const avisar = () => { try { window.dispatchEvent(new Event("regenta:cola")); } catch {} };

/** ¿Falló la red (no la venta)? fetch lanza TypeError cuando no hay conexión. */
export const esFallaDeRed = (e: unknown) => e instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);

// ── Catálogo local
export async function actualizarCatalogo() {
  try {
    const r = await fetch("/api/productos?catalogo=1", { cache: "no-store" });
    if (!r.ok) return false;
    const j = await r.json();
    return escribir(K_CATALOGO, { v: V_CATALOGO, t: Date.now(), empresa: j.empresa, productos: j.productos });
  } catch { return false; }
}
export const catalogo = () => {
  const c = leer<{ v?: number; t: number; empresa: string; productos: ProductoCaja[] } | null>(K_CATALOGO, null);
  return c?.v === V_CATALOGO ? c : null;
};

/** Busca como el servidor: código de barras exacto (principal o alterno) o todas las palabras en nombre + laboratorio.
 *  Descuenta lo vendido sin internet. */
export function buscarLocal(q: string): ProductoCaja[] {
  const c = catalogo(); if (!c) return [];
  const t = q.trim().toLowerCase(); if (!t) return [];
  const palabras = t.split(/\s+/).slice(0, 6);
  const codigo = q.replace(/\s/g, "").toUpperCase(); // como se guardan los códigos alternos
  const exacto = (p: ProductoCaja) => p.ean === q.trim() || (p.codigos ?? []).includes(codigo);
  const usadas = new Map<string, number>();
  for (const v of cola().filter((x) => !x.error)) for (const l of v.lineas) usadas.set(l.producto_id, (usadas.get(l.producto_id) ?? 0) + l.unidades);
  return c.productos
    .filter((p) => exacto(p) || palabras.every((w) => `${p.nombre} ${p.laboratorio ?? ""}`.toLowerCase().includes(w)))
    .map((p) => ({ ...p, unidades: Math.max(0, p.unidades - (usadas.get(p.id) ?? 0)), exacto: exacto(p) }))
    .sort((a, b) => Number(b.exacto) - Number(a.exacto) || Number(b.unidades > 0) - Number(a.unidades > 0) || a.nombre.localeCompare(b.nombre))
    .slice(0, 30);
}

// ── Cola de ventas
export const cola = () => leer<VentaEnCola[]>(K_COLA, []);
export function encolar(v: VentaEnCola) {
  const ok = escribir(K_COLA, [...cola().filter((x) => x.idem_key !== v.idem_key), v]);
  avisar(); return ok;
}
/** Vuelve a intentar una venta que falló. Si el error fue que el precio cambió («no cubre el total»), con `precioHoy`
 *  se registra al precio actual: el pago se ajusta al total nuevo (lo que ya se cobró en caja queda como diferencia). */
export function reintentar(idem: string, precioHoy = false) {
  escribir(K_COLA, cola().map((x) => {
    if (x.idem_key !== idem) return x;
    const total = precioHoy ? Number(String(x.error ?? "").match(/no cubre el total \((\d+(?:\.\d+)?)\)/)?.[1] ?? 0) : 0;
    const pagos = (x.cuerpo.pagos as { medio: string; valor: number }[] | undefined) ?? [];
    const cuerpo = total && pagos.length ? { ...x.cuerpo, pagos: [{ ...pagos[0], valor: Math.ceil(total) }] } : x.cuerpo;
    return { ...x, cuerpo, error: undefined, aviso: undefined };
  }));
  avisar();
}
export function descartar(idem: string) { escribir(K_COLA, cola().filter((x) => x.idem_key !== idem)); avisar(); }

let enCurso = false;
/** Envía las ventas pendientes de esta droguería. Devuelve cuántas quedaron registradas y si la sesión venció. */
export async function sincronizar(empresa: string | null): Promise<{ enviadas: number; sesion: boolean; pendientes: number }> {
  if (enCurso) return { enviadas: 0, sesion: false, pendientes: cola().length };
  enCurso = true;
  let enviadas = 0, sesion = false;
  try {
    for (const v of cola()) {
      if (v.error || (empresa && v.empresa !== empresa)) continue; // nunca se envía una venta a otra droguería
      let r: Response;
      try { r = await fetch("/api/ventas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v.cuerpo) }); }
      catch { break; } // sigue sin internet
      if (r.status === 401) { sesion = true; break; }
      if (r.ok) { descartar(v.idem_key); enviadas++; continue; }
      if (r.status >= 500 || r.status === 429) break; // el servidor se recupera: se reintenta luego
      const j = await r.json().catch(() => ({}));
      // Errores que se arreglan solos o con una acción en la droguería (abrir el turno, recibir mercancía, reactivar la
      // cuenta, cargar la resolución): la venta sigue en cola y se reintenta en la próxima sincronización.
      if (/turno|existencias|suspendida|habilitada|resoluci[oó]n|numeraci[oó]n/i.test(String(j.error ?? ""))) {
        escribir(K_COLA, cola().map((x) => (x.idem_key === v.idem_key ? { ...x, aviso: j.error } : x))); avisar(); continue;
      }
      // Un producto que se marcó con fórmula después de guardar el catálogo: la venta no se puede registrar sin esos datos.
      const msg = /f[oó]rmula/i.test(String(j.error ?? ""))
        ? `${j.error}. Registra esta venta de nuevo en la caja con los datos de la fórmula y luego marca «Ya la registré a mano»`
        : j.error ?? `No se pudo registrar (${r.status})`;
      escribir(K_COLA, cola().map((x) => (x.idem_key === v.idem_key ? { ...x, error: msg } : x))); avisar();
    }
  } finally { enCurso = false; }
  return { enviadas, sesion, pendientes: cola().filter((x) => !x.error).length };
}

/** Comprobante provisional en la impresora (sin pedir nada al servidor: funciona sin internet). */
export function imprimirProvisional(v: VentaEnCola, empresaNombre: string, ancho: "80" | "58") {
  const p = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const fecha = new Date(v.creado).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
  const filas = v.lineas.map((l) => `<p>${esc(l.nombre)}</p><p class="f"><span>${l.cantidad} ${l.presentacion === "caja" ? "caja" : "und"}</span><span>${p(l.total)}</span></p>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Comprobante provisional</title><style>
    @page{size:${ancho}mm auto;margin:0}body{margin:0;background:#fff}main{width:${Number(ancho) - 8}mm;margin:0 auto;padding:3mm 4mm 6mm;color:#000;font:${ancho === "58" ? 10.5 : 12}px/1.35 ui-monospace,Menlo,Consolas,monospace}
    p{margin:0}.c{text-align:center}.b{font-weight:700}hr{border:0;border-top:1px dashed #000;margin:6px 0}.f{display:flex;justify-content:space-between;gap:8px}.g{font-size:1.15em;font-weight:700}
  </style></head><body><main><p class="c b">${esc(empresaNombre)}</p><hr><p class="c b">COMPROBANTE PROVISIONAL</p><p class="c">Venta registrada sin internet</p><p class="c">${fecha}</p><hr>${filas}<hr>
    <p class="f g"><span>Total</span><span>${p(v.total)}</span></p>${v.cambio > 0 ? `<p class="f"><span>Cambio</span><span>${p(v.cambio)}</span></p>` : ""}<hr>
    <p>No es un documento electrónico. El tiquete POS electrónico se emite al volver internet; pídalo en la droguería si lo necesita.</p>
    <p class="c" style="margin-top:6px">Ref. ${v.idem_key.slice(0, 8).toUpperCase()}</p></main></body></html>`;
  const f = document.createElement("iframe");
  f.title = "Comprobante provisional"; f.setAttribute("aria-hidden", "true");
  Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  f.onload = () => setTimeout(() => { try { f.contentWindow?.print(); } catch {} }, 200); // imprime desde la página (sin script dentro del comprobante)
  f.srcdoc = html; document.body.appendChild(f);
  setTimeout(() => f.remove(), 120000);
}
