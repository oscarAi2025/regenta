"use client";
import { guardarImpresora, imprimirVenta, leerImpresora, type Impresora } from "@/lib/impresion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pesos } from "@/lib/formato";
import { ClienteFactura, documento, type Cliente, type CreditoCaja, esConsumidorFinal } from "./ClienteFactura";
import { actualizarCatalogo, buscarLocal, catalogo, cola, descartar, encolar, reintentar, esFallaDeRed, imprimirProvisional, sincronizar, type VentaEnCola } from "@/lib/sin-conexion";
import { FORMULA_VACIA, errorFormula, exigencia, limpiarDoc, pideFormula, type ConfigFormula, type DatosFormula } from "@/lib/control-especial";
import { MAX_CANTIDAD, etiquetaPedido, netoLinea, prefijoCantidad, type TipoPedido } from "@/lib/pedidos";
import { PanelFormula } from "./PanelFormula";
import { Fila } from "./Productos";
import { LineaVenta } from "./LineaVenta";
import { Hecho } from "./Hecho";
import { Cobro } from "./Cobro";
import { GuardarPedido, ListaPedidos, type DatosPedido, type PedidoGuardado } from "./Espera";
import { borrarVentaLocal, guardarVentaLocal, leerVentaLocal } from "./venta-local";
import { precioDe, unidadesDe, type Linea, type Medio, type PedidoVinculado, type Producto, type Resultado } from "./tipos";

const PLAZOS = [15, 30, 45, 60, 90];
type DetallePedido = Omit<PedidoGuardado, "lineas"> & PedidoVinculado & { cliente_datos: Cliente | null; lineas: (Omit<PedidoGuardado["lineas"][number], "producto"> & { producto: Producto & { activo?: boolean } })[] };

export function Caja({ fiar, gerencia, empresa, nombreEmpresa, formulas, caja, responsableIva, descuentoMax, soloFactura = false }: { fiar: boolean;
  /** La droguería factura en producción pero su POS sigue en pruebas: toda venta va con factura electrónica. */ soloFactura?: boolean;
  /** Dueño o administrador: fían también a clientes sin cupo y se pasan del cupo escribiendo el motivo. */ gerencia: boolean;
  empresa: string; nombreEmpresa: string; formulas: ConfigFormula; caja: string | null;
  /** No responsable de IVA: la venta no discrimina IVA aunque el producto lo tenga (igual que registrar_venta). */ responsableIva: boolean;
  /** Tope de descuento de la cajera (línea y general juntos); null para el dueño y el administrador. */ descuentoMax: number | null }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Producto[]>([]);
  const [sel, setSel] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [cobrando, setCobrando] = useState(false);
  const [medio, setMedio] = useState<Medio>("efectivo");
  const [recibido, setRecibido] = useState("");
  // Pago mixto: una parte con otro medio (tarjeta, Nequi…) y el resto en efectivo.
  const [otro, setOtro] = useState<{ medio: Medio; valor: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState<Resultado | null>(null);
  const [impresora, setImpresora] = useState<Impresora>({ auto: true, ancho: "80", factura: "carta" });
  useEffect(() => setImpresora(leerImpresora()), []);
  const cambiarImpresora = (i: Impresora) => { setImpresora(i); guardarImpresora(i); };
  const [vencen, setVencen] = useState<Producto[]>([]);
  const [tipoDoc, setTipoDoc] = useState<"pos" | "factura">(soloFactura ? "factura" : "pos");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [credito, setCredito] = useState(false);
  const [plazo, setPlazo] = useState(30);
  // Crédito del cliente elegido (GET /api/clientes/[id]/credito con el total) y motivo cuando la gerencia se pasa del cupo.
  const [cred, setCred] = useState<CreditoCaja | null>(null);
  const [motivoCredito, setMotivoCredito] = useState("");
  const idem = useRef<string>(crypto.randomUUID());
  // Fórmula médica de la venta (productos con fórmula o de control especial).
  const [formula, setFormula] = useState<DatosFormula>(FORMULA_VACIA);
  // Mostrador ágil: «12*» antes de escanear, pedido del servidor abierto en la caja, cuadros de espera/domicilio/cotización.
  const [mult, setMult] = useState<number | null>(null);
  const multRef = useRef<number | null>(null);
  multRef.current = mult;
  const [pedido, setPedido] = useState<PedidoVinculado | null>(null);
  const [cobrado, setCobrado] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<null | TipoPedido | "lista">(null);
  const [aviso, setAviso] = useState("");
  const [avisoBuscar, setAvisoBuscar] = useState(""); // junto al buscador (en el celular la tirilla queda abajo)
  const [recuperada, setRecuperada] = useState(false);
  const [domicilios, setDomicilios] = useState<Record<string, { unidades: number; pedidos: number }>>({});
  const [pedidoInicial, setPedidoInicial] = useState<string | null>(null); // ?pedido= al entrar desde Pedidos
  const listo = useRef(false); // ya se intentó recuperar la venta guardada en el navegador (no se pisa antes)
  // Sin internet: catálogo local, cola de ventas y aviso del estado.
  const [enLinea, setEnLinea] = useState(true);
  const [pendientes, setPendientes] = useState(0);
  const [fallidas, setFallidas] = useState<VentaEnCola[]>([]);
  const [avisoCola, setAvisoCola] = useState("");
  // Pendientes: se envían solas. Con error o con aviso (no hay existencias, falta el turno…): se muestran con sus
  // acciones, para que nadie crea que ya entraron (antes las del aviso quedaban «pendientes» para siempre, sin decir por qué).
  const contar = useCallback(() => { const c = cola().filter((v) => v.empresa === empresa); setPendientes(c.filter((v) => !v.error && !v.aviso).length); setFallidas(c.filter((v) => v.error || v.aviso)); }, [empresa]);
  const enviarCola = useCallback(async () => {
    if (!cola().some((v) => v.empresa === empresa && !v.error)) return;
    const r = await sincronizar(empresa);
    if (r.enviadas) setAvisoCola(`${r.enviadas} venta${r.enviadas === 1 ? "" : "s"} hecha${r.enviadas === 1 ? "" : "s"} sin internet ya ${r.enviadas === 1 ? "quedó registrada" : "quedaron registradas"} y en camino a la DIAN.`);
    if (r.sesion) setAvisoCola("Tu sesión venció: entra de nuevo para enviar las ventas hechas sin internet. Siguen guardadas en esta caja.");
    contar();
  }, [empresa, contar]);
  useEffect(() => {
    setEnLinea(navigator.onLine); contar();
    void actualizarCatalogo(); void enviarCola();
    const on = () => { setEnLinea(true); void enviarCola(); void actualizarCatalogo(); };
    const off = () => setEnLinea(false);
    addEventListener("online", on); addEventListener("offline", off); addEventListener("regenta:cola", contar);
    const t1 = setInterval(() => void enviarCola(), 20000);
    const t2 = setInterval(() => { if (navigator.onLine) void actualizarCatalogo(); }, 600000);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); removeEventListener("regenta:cola", contar); clearInterval(t1); clearInterval(t2); };
  }, [contar, enviarCola]);
  const buscador = useRef<HTMLInputElement>(null);
  const recibidoRef = useRef<HTMLInputElement>(null);

  // Búsqueda con espera corta (el lector de código de barras escribe muy rápido y termina con Enter).
  useEffect(() => {
    const t = q.trim();
    if (!t) { setRes([]); return; }
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      setBuscando(true);
      const local = () => { const c = catalogo(); if (c?.empresa === empresa) { setRes(buscarLocal(t)); setSel(0); } };
      try {
        if (!navigator.onLine) { local(); return; }
        const r = await fetch(`/api/productos?q=${encodeURIComponent(t)}`, { signal: ctl.signal });
        if (r.status === 401) { location.href = "/entrar"; return; }
        const j = await r.json();
        setRes(j.productos ?? []); setSel(0);
      } catch (e) { if (!ctl.signal.aborted && esFallaDeRed(e)) { setEnLinea(false); local(); } } finally { setBuscando(false); }
    }, 140);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [q]);

  // Lista de «ofrécelos primero»: se recarga al empezar cada venta.
  useEffect(() => {
    if (hecho) return;
    fetch("/api/productos?vencen=1").then((r) => (r.ok ? r.json() : { productos: [] })).then((j) => setVencen(j.productos ?? [])).catch(() => {});
  }, [hecho]);

  // Agrega el producto con la cantidad pedida con «12*» (o una) y la suma si ya está en la venta.
  const agregar = useCallback((p: Producto, presentacion: "caja" | "unidad") => {
    if (p.unidades <= 0) { setAvisoBuscar(`${p.nombre} está agotado: abre «Ver alternativas con existencias» en la lista`); return; }
    const n = multRef.current ?? 1;
    let excedido = false;
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.p.id === p.id && l.presentacion === presentacion);
      if (i >= 0) {
        if (ls[i].cantidad + n > MAX_CANTIDAD) { excedido = true; return ls; }
        return ls.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + n } : l));
      }
      return [...ls, { key: crypto.randomUUID(), p, presentacion, cantidad: n, descuento: 0 }];
    });
    setMult(null); setQ(""); setRes([]); setError(excedido ? `Máximo ${MAX_CANTIDAD.toLocaleString("es-CO")} por producto` : "");
    buscador.current?.focus();
  }, []);

  // Descuento general sobre toda la venta (%). Se combina con el de cada línea igual que en la base de datos.
  const [descGeneral, setDescGeneral] = useState(0);
  const neto = useCallback((l: Linea) => netoLinea(precioDe(l), l.cantidad, l.descuento, descGeneral), [descGeneral]);
  const totales = useMemo(() => {
    let total = 0, iva = 0, descuento = 0;
    for (const l of lineas) {
      const { bruto, neto: n } = neto(l);
      total += n; descuento += bruto - n; if (responsableIva) iva += n - n / (1 + l.p.iva / 100);
    }
    return { total, iva, base: total - iva, descuento, items: lineas.reduce((a, l) => a + l.cantidad, 0) };
  }, [lineas, neto, responsableIva]);

  // Unidades pedidas de un producto (sumando caja y unidad) frente a sus existencias.
  const excede = useCallback((ls: Linea[], p: Producto) => ls.filter((l) => l.p.id === p.id).reduce((a, l) => a + unidadesDe(l), 0) > p.unidades, []);

  const limpiar = useCallback(() => {
    setLineas([]); setHecho(null); setCobrando(false); setRecibido(""); setMedio("efectivo"); setOtro(null); setDescGeneral(0); setError(""); setCliente(null); setCredito(false); setCred(null); setMotivoCredito(""); setFormula(FORMULA_VACIA);
    setPedido(null); setMult(null); setRecuperada(false); setCobrado(null);
    idem.current = crypto.randomUUID();
  }, []);
  const nueva = useCallback(() => {
    limpiar(); setAviso("");
    borrarVentaLocal(empresa, caja);
    setTimeout(() => buscador.current?.focus(), 0);
  }, [limpiar, empresa, caja]);

  // La venta en curso se guarda en el navegador (por caja) y se recupera al recargar.
  useEffect(() => {
    if (!listo.current) return;
    if (hecho) { borrarVentaLocal(empresa, caja); return; }
    guardarVentaLocal(empresa, caja, { idem: idem.current, lineas, tipoDoc, cliente, credito, plazo, descGeneral, formula, pedido });
  }, [lineas, tipoDoc, cliente, credito, plazo, descGeneral, formula, pedido, hecho, empresa, caja]);

  // Pedido del servidor → venta de la caja, al precio y existencias de hoy (avisa si el precio cambió).
  const abrirPedido = useCallback((d: DetallePedido) => {
    const activas = d.lineas.filter((l) => l.producto.activo !== false);
    limpiar();
    setLineas(activas.map((l) => {
      const p = l.producto; const ahora = l.presentacion === "caja" ? p.precio_caja : p.precio_unidad ?? 0;
      return { key: crypto.randomUUID(), p, presentacion: l.presentacion, cantidad: l.cantidad, descuento: l.descuento_pct, antes: ahora !== l.precio_mostrado ? l.precio_mostrado : undefined };
    }));
    setDescGeneral(d.descuento_pct);
    if (d.cliente_datos) setCliente(d.cliente_datos);
    setPedido({ id: d.id, tipo: d.tipo, numero: d.numero, contacto: d.contacto, estado: d.estado, telefono: d.telefono, direccion: d.direccion, nota: d.nota });
    const cambios = activas.filter((l) => (l.presentacion === "caja" ? l.producto.precio_caja : l.producto.precio_unidad ?? 0) !== l.precio_mostrado).length;
    const quitados = d.lineas.length - activas.length;
    setAviso([`${etiquetaPedido(d)}${d.contacto ? ` · ${d.contacto}` : ""} está en la caja.`, cambios ? `${cambios === 1 ? "Un producto cambió" : `${cambios} productos cambiaron`} de precio desde entonces: se cobra el de hoy.` : "",
      quitados ? `${quitados} producto${quitados === 1 ? " ya no está activo y se quitó" : "s ya no están activos y se quitaron"}.` : ""].filter(Boolean).join(" "));
    setTimeout(() => buscador.current?.focus(), 0);
  }, [limpiar]);

  // Guarda la venta actual como pedido (nuevo, o actualiza el que ya estaba abierto si es del mismo tipo).
  const guardarComo = useCallback(async (tipo: TipoPedido, d: DatosPedido): Promise<{ pedido: PedidoGuardado & { id: string } } | { error: string }> => {
    const cuerpo = {
      tipo, cliente_id: cliente?.id ?? null, contacto: d.contacto, telefono: d.telefono, direccion: d.direccion, nota: d.nota, vence: d.vence, descuento_pct: descGeneral,
      lineas: lineas.map((l) => ({ producto_id: l.p.id, presentacion: l.presentacion, cantidad: l.cantidad, descuento_pct: l.descuento })),
    };
    const mismo = pedido && pedido.tipo === tipo && pedido.estado === "abierto";
    try {
      const r = await fetch(mismo ? `/api/pedidos/${pedido.id}` : "/api/pedidos", { method: mismo ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json();
      if (!r.ok) return { error: j.error ?? "No se pudo guardar" };
      // La venta venía de otro pedido (p. ej. una espera que se volvió domicilio): el anterior se cancela con el motivo.
      if (pedido && !mismo && pedido.estado === "abierto")
        await fetch(`/api/pedidos/${pedido.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ estado: "cancelado", motivo: `Pasó a ${etiquetaPedido(j.pedido)}` }) }).catch(() => {});
      return j;
    } catch { return { error: "Sin conexión con el servidor: la venta sigue en la caja" }; }
  }, [cliente, descGeneral, lineas, pedido]);

  const recuperar = useCallback(async (id: string) => {
    setDialogo(null); setError("");
    let previa = "";
    if (lineas.length && !hecho) {
      const r = await guardarComo("espera", { contacto: pedido?.contacto ?? "", telefono: "", direccion: "", nota: "", vence: null });
      if ("error" in r) { setError(`No se pudo poner en espera la venta actual: ${r.error}`); return; }
      previa = `La venta que tenías quedó en espera N.º ${r.pedido.numero}. `;
    }
    try {
      const r = await fetch(`/api/pedidos/${id}`);
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo abrir el pedido"); return; }
      const d = j.pedido as DetallePedido;
      if (d.estado === "cobrado" || d.estado === "cancelado") { limpiar(); setAviso(`${previa}${etiquetaPedido(d)} ya está ${d.estado}.`); return; }
      abrirPedido(d);
      if (previa) setAviso((a) => previa + a);
    } catch { setError("Sin conexión con el servidor: no se pudo abrir el pedido"); }
  }, [lineas.length, hecho, guardarComo, pedido, abrirPedido, limpiar]);

  // Al entrar: recupera la venta guardada en el navegador y, si viene ?pedido=, abre ese pedido.
  useEffect(() => {
    const v = leerVentaLocal(empresa, caja);
    if (v) {
      setLineas(v.lineas); setTipoDoc(soloFactura ? "factura" : v.tipoDoc); setCliente(v.cliente); setCredito(v.credito); setPlazo(v.plazo); setDescGeneral(v.descGeneral);
      setFormula(v.formula ?? FORMULA_VACIA); setPedido(v.pedido); idem.current = v.idem; setRecuperada(true);
    }
    listo.current = true;
    const id = new URLSearchParams(location.search).get("pedido");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      history.replaceState(history.state, "", location.pathname);
      setPedidoInicial(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (pedidoInicial) { setPedidoInicial(null); setRecuperada(false); void recuperar(pedidoInicial); } }, [pedidoInicial, recuperar]);

  // Aviso (no reserva): unidades de los productos de esta venta que van en domicilios abiertos.
  const ids = useMemo(() => [...new Set(lineas.map((l) => l.p.id))].sort().join(","), [lineas]);
  useEffect(() => {
    if (!ids || !enLinea) { setDomicilios({}); return; }
    const ctl = new AbortController();
    const h = setTimeout(() => {
      fetch(`/api/pedidos?en_domicilio=${ids}${pedido ? `&excluir=${pedido.id}` : ""}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { productos: {} })).then((j) => setDomicilios(j.productos ?? {})).catch(() => {});
    }, 300);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [ids, pedido, enLinea]);

  // «Crédito» se ofrece cuando la base dice que se le puede fiar (la cajera, dentro del cupo) o, a la gerencia, cuando puede
  // autorizarlo con un motivo; mientras no hay respuesta, la gerencia lo ve como siempre y la cajera no. La base vuelve a
  // decidir al registrar.
  const credCliente = cliente && cred?.id === cliente.id ? cred : null;
  const ofreceCredito = tipoDoc === "factura" && fiar && (credCliente ? credCliente.puede_fiar || credCliente.requiere_motivo : gerencia);
  const aCredito = credito && ofreceCredito;
  const pideMotivo = aCredito && !!credCliente && !credCliente.puede_fiar && credCliente.requiere_motivo;
  const faltaMotivo = pideMotivo && motivoCredito.trim().length < 4;
  useEffect(() => { if (credito && cliente && credCliente && !ofreceCredito) setCredito(false); }, [credito, cliente, credCliente, ofreceCredito]);
  // El plazo por defecto del cliente, al elegirlo.
  const clienteId = cliente?.id ?? null;
  const plazoCliente = credCliente?.plazo_dias ?? null;
  useEffect(() => { if (clienteId && plazoCliente && PLAZOS.includes(plazoCliente)) setPlazo(plazoCliente); }, [clienteId, plazoCliente]);
  const otroNum = medio === "efectivo" && otro ? Math.min(Number(otro.valor.replace(/\D/g, "")) || 0, Math.round(totales.total)) : 0;
  const restante = Math.round(totales.total) - otroNum; // lo que falta cubrir en efectivo
  // «Recibido» vacío = pago exacto (el campo lo muestra como sugerencia; Enter sin escribir no debe dar error).
  const recibidoNum = medio === "efectivo" && !aCredito ? (recibido.trim() === "" ? restante : Number(recibido.replace(/\D/g, "")) || 0) : totales.total;
  const cambio = Math.max(0, recibidoNum - restante);
  const faltaCliente = tipoDoc === "factura" && !cliente;
  const ex = useMemo(() => exigencia(lineas.map((l) => l.p), formulas), [lineas, formulas]);
  const pide = pideFormula(ex);
  const faltaFormula = pide ? errorFormula(formula, ex, formulas) : null;
  const formulaSinRed = !enLinea && ex.datos; // sin internet no se garantiza el registro: esos productos no se venden
  // La factura electrónica necesita el correo del cliente (registrar_venta lo exige): se pide antes de cobrar.
  const faltaCorreo = tipoDoc === "factura" && !!cliente && !cliente.email && !esConsumidorFinal(cliente);
  // Tope de descuento de la cajera: línea y general combinados, igual que en la base (antes solo fallaba al confirmar).
  const descuentoExcedido = descuentoMax !== null && lineas.some((l) => 100 - (100 - l.descuento) * (100 - descGeneral) / 100 > descuentoMax + 0.001);
  const puedeCobrar = lineas.length > 0 && !lineas.some((l) => excede(lineas, l.p)) && !faltaCliente && !faltaFormula && !formulaSinRed && !faltaMotivo && !faltaCorreo && !descuentoExcedido;
  const preciosCambiados = lineas.filter((l) => l.antes !== undefined && l.antes !== precioDe(l)).length;
  // F9 o «Cobrar» con la fórmula incompleta llevan al primer dato que falta (lector y teclado no se quedan sin salida).
  const irAFormula = useCallback(() => {
    const panel = document.getElementById("formula");
    if (!panel) return;
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    const vacio = [...panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")].find((x) => x instanceof HTMLInputElement && (x.type === "checkbox" ? !x.checked : !x.value.trim()));
    (vacio ?? panel.querySelector<HTMLElement>("input, select"))?.focus({ preventScroll: true });
  }, []);

  async function confirmar() {
    if (enviando) return;
    if (!puedeCobrar && faltaMotivo && !faltaCliente && !faltaFormula && !formulaSinRed) { setError("Escribe el motivo de la autorización para fiar por encima de lo permitido"); document.getElementById("motivo-credito")?.focus(); return; }
    if (!puedeCobrar) { if (faltaFormula || formulaSinRed) { setError(formulaSinRed ? "Sin internet no se puede registrar la fórmula médica" : faltaFormula!); irAFormula(); } return; }
    if (!aCredito && medio === "efectivo" && otro && (otroNum <= 0 || otroNum >= Math.round(totales.total))) { setError("En el pago mixto, la parte con el otro medio debe ser menor que el total"); return; }
    if (!aCredito && medio === "efectivo" && recibidoNum < restante) { setError(otroNum ? `El efectivo no cubre el resto (${pesos(restante)})` : "El efectivo recibido no cubre el total"); return; }
    setEnviando(true); setError("");
    const cuerpo = {
          idem_key: idem.current, tipo_doc: tipoDoc, cliente_id: tipoDoc === "factura" ? cliente?.id : null,
          condicion: aCredito ? "credito" : "contado", plazo_dias: aCredito ? plazo : null, motivo_credito: pideMotivo ? motivoCredito.trim() : null,
          lineas: lineas.map((l) => ({ producto_id: l.p.id, presentacion: l.presentacion, cantidad: l.cantidad, descuento_pct: l.descuento })),
          descuento_pct: descGeneral,
          pagos: aCredito ? [] : medio === "efectivo" && otroNum > 0
            ? [{ medio: otro!.medio, valor: otroNum }, { medio: "efectivo", valor: recibidoNum }]
            : [{ medio, valor: medio === "efectivo" ? recibidoNum : Math.round(totales.total) }],
          formula: pide ? (ex.datos ? { ...formula, verificada: true, paciente_doc: limpiarDoc(formula.paciente_doc) } : { ...FORMULA_VACIA, verificada: formula.verificada }) : null,
          // Lo que la persona ve en pantalla: si el precio cambió con la venta abierta, el servidor no cobra otro total.
          total_mostrado: Math.round(totales.total),
    };
    try {
      const r = await fetch(pedido ? `/api/pedidos/${pedido.id}/cobrar` : "/api/ventas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json();
      if (r.status === 409 && Array.isArray(j.precios)) {
        // Cambió el precio de algún producto mientras la venta estaba abierta: se ponen los de hoy y se avisa antes de cobrar.
        const hoy = new Map<string, { precio_caja: number; precio_unidad: number | null }>(j.precios.map((x: { id: string; precio_caja: number; precio_unidad: number | null }) => [x.id, x]));
        setLineas((ls) => ls.map((l) => {
          const n = hoy.get(l.p.id); if (!n) return l;
          const antes = precioDe(l), p = { ...l.p, precio_caja: Number(n.precio_caja), precio_unidad: n.precio_unidad === null ? null : Number(n.precio_unidad) };
          const ahora = l.presentacion === "caja" ? p.precio_caja : p.precio_unidad ?? 0;
          return ahora === antes ? { ...l, p } : { ...l, p, antes: l.antes ?? antes };
        }));
        setRecibido(""); setError(j.error); return;
      }
      if (!r.ok) { setError(typeof j.error === "string" ? j.error : "No se pudo registrar la venta"); return; }
      setHecho(j); setCobrando(false); setCobrado(pedido ? etiquetaPedido(pedido) : null); setPedido(null); setAviso("");
      setTimeout(() => buscador.current?.focus(), 0); // el lector queda listo para el siguiente cliente
      window.dispatchEvent(new CustomEvent("regenta:venta", { detail: { total: Number(j.venta?.total ?? 0), documento: j.documento?.estado ?? null } }));
      if (impresora.auto && j.venta?.venta_id) imprimirVenta(j.venta.venta_id, j.documento?.tipo ?? tipoDoc, impresora);
    } catch (e) {
      if (!esFallaDeRed(e)) { setError("No se pudo registrar la venta. Vuelve a confirmar (no se duplicará)."); return; }
      setEnLinea(false);
      if (pedido) { setError(`Sin internet no se cobra ${etiquetaPedido(pedido)}: espera la conexión (no se duplicará) o suéltalo para venderlo como venta normal y luego cancélalo en Pedidos.`); return; }
      if (ex.datos) { setError("Sin internet no se puede registrar la fórmula médica. Quita esos productos de la venta o espera a que vuelva la conexión."); return; }
      if (tipoDoc !== "pos" || aCredito) { setError(soloFactura ? "Sin internet no se puede facturar: la factura electrónica necesita conexión. Vuelve a confirmar cuando regrese (no se duplicará)." : "Sin internet: la factura electrónica necesita conexión. Cobra con tiquete POS y se envía solo al volver internet."); return; }
      // Sin internet: la venta se guarda en esta caja y se envía sola al volver la conexión (misma clave: no se duplica).
      // Lleva la hora real: al registrarse, queda en el día y el turno en que se vendió (no en el de la sincronización).
      const ahora = new Date().toISOString();
      const v: VentaEnCola = {
        idem_key: idem.current, empresa, creado: ahora, cuerpo: { ...cuerpo, sin_conexion: true, creado: ahora }, total: Math.round(totales.total), cambio: medio === "efectivo" ? cambio : 0,
        lineas: lineas.map((l) => ({ nombre: l.p.nombre, cantidad: l.cantidad, presentacion: l.presentacion, total: neto(l).neto, producto_id: l.p.id, unidades: unidadesDe(l) })),
      };
      if (!encolar(v)) { setError("Sin internet y este navegador no deja guardar la venta. Anótala y regístrala al volver la conexión."); return; }
      setHecho({ provisional: v, venta: { venta_id: "", prefijo: "", numero: 0, total: v.total, cambio: v.cambio, base: 0, iva: 0 }, documento: { tipo: "pos", estado: "pendiente", cufe: null, simulado: false, ultimo_error: null } });
      setCobrando(false); contar(); setTimeout(() => buscador.current?.focus(), 0);
      if (impresora.auto) imprimirProvisional(v, nombreEmpresa, impresora.ancho);
    } finally { setEnviando(false); }
  }

  const abrirCobro = useCallback(() => { setCobrando(true); setTimeout(() => recibidoRef.current?.focus(), 0); }, []);
  const ponerEnEspera = useCallback(() => {
    if (hecho) return;
    if (!lineas.length) { setError("No hay productos para poner en espera"); return; }
    setError(""); setDialogo("espera");
  }, [hecho, lineas.length]);

  // Atajos: F2 buscar, F4 en espera, F6 recuperar, F9 cobrar, F8 imprimir, Esc volver, Enter nueva venta tras cobrar.
  // Un solo escuchador que siempre llama a la versión más reciente (se actualiza tras cada render, antes de la siguiente
  // tecla): con el escuchador re-registrado por efecto, una F9 justo después de escribir el motivo usaba el estado anterior
  // y no abría el cobro (medido en la prueba de crédito).
  const atajo = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    atajo.current = (e: KeyboardEvent) => {
      if (dialogo) return; // el cuadro abierto maneja sus teclas
      if (e.key === "F2") { e.preventDefault(); buscador.current?.focus(); }
      if (e.key === "F4") { e.preventDefault(); ponerEnEspera(); }
      if (e.key === "F6") { e.preventDefault(); if (!hecho) setDialogo("lista"); }
      if (e.key === "F9" && puedeCobrar && !hecho) { e.preventDefault(); abrirCobro(); }
      else if (e.key === "F9" && !hecho && lineas.length > 0 && (faltaFormula || formulaSinRed)) { e.preventDefault(); irAFormula(); }
      if (e.key === "Escape" && cobrando) { setCobrando(false); buscador.current?.focus(); }
      else if (e.key === "Escape" && mult !== null) { setMult(null); }
      if (e.key === "Enter" && hecho && !(e.target instanceof HTMLInputElement && e.target.id === "buscar" && e.target.value)) { e.preventDefault(); nueva(); }
      if (e.key === "F8" && hecho?.provisional) { e.preventDefault(); imprimirProvisional(hecho.provisional, nombreEmpresa, impresora.ancho); }
      else if (e.key === "F8" && hecho?.venta.venta_id) { e.preventDefault(); imprimirVenta(hecho.venta.venta_id, hecho.documento?.tipo, impresora); }
    };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => atajo.current(e);
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, []);

  function escribir(v: string) {
    setAvisoBuscar("");
    // Venta ya cobrada: lo que llega (el lector escaneando el primer producto del siguiente cliente) empieza la nueva.
    if (hecho) { limpiar(); setAviso(""); borrarVentaLocal(empresa, caja); }
    const pre = prefijoCantidad(v);
    if (!pre) { setQ(v); return; }
    if (pre.error) { setError(pre.error); setMult(null); } else { setMult(pre.cantidad); setError(""); }
    setQ(pre.resto);
  }

  function teclaBuscador(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, res.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Backspace" && !q && mult !== null) { e.preventDefault(); setMult(null); return; }
    // Lector de código de barras: escribe el código y Enter antes de que termine la búsqueda. Con un código completo se
    // busca ya mismo el producto exacto y se agrega (una caja); la búsqueda queda limpia para el siguiente.
    const t = q.trim();
    if (e.key === "Enter" && /^\d{7,14}$/.test(t)) {
      e.preventDefault();
      const exacto = (l: Producto[]) => l.find((p) => p.exacto || p.ean === t); // exacto: también por código alterno
      const ya = exacto(res);
      if (ya) { agregar(ya, "caja"); setQ(""); return; }
      (async () => {
        let lista: Producto[] = [];
        try {
          if (navigator.onLine) lista = (await (await fetch(`/api/productos?q=${encodeURIComponent(t)}`)).json()).productos ?? [];
          else lista = buscarLocal(t);
        } catch { lista = buscarLocal(t); }
        const p = exacto(lista);
        if (p) { agregar(p, "caja"); setQ(""); } else if (lista[0]) { setRes(lista); setSel(0); }
      })();
      return;
    }
    if (e.key === "Enter" && res[sel]) { e.preventDefault(); agregar(res[sel], "caja"); }
  }

  const boton = "h-9 px-3 rounded-lg border border-line text-sm font-semibold hover:border-ink disabled:opacity-40 inline-flex items-center justify-center gap-1.5";
  return (
    <div className="grid xl:grid-cols-[1fr_440px] gap-5 p-4 sm:p-6 pb-28 xl:pb-6 items-start">
      {/* Buscar y agregar */}
      <section aria-label="Productos" className="min-w-0">
        {(!enLinea || pendientes > 0) && (
          <p role="status" className={`mb-3 rounded-xl px-4 py-3 font-semibold ${enLinea ? "bg-aviso-soft text-aviso" : "bg-ink text-white"}`}>
            {!enLinea ? "Sin internet: sigues vendiendo con tiquete POS. " : "Enviando las ventas hechas sin internet… "}
            {pendientes > 0 && `${pendientes} venta${pendientes === 1 ? "" : "s"} guardada${pendientes === 1 ? "" : "s"} en esta caja, se envía${pendientes === 1 ? "" : "n"} sola${pendientes === 1 ? "" : "s"} al volver la conexión.`}
          </p>
        )}
        {avisoCola && <p role="status" className="mb-3 rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold flex justify-between gap-3">{avisoCola}<button onClick={() => setAvisoCola("")} className="text-sm underline shrink-0">Cerrar</button></p>}
        {recuperada && lineas.length > 0 && !hecho && (
          <p role="status" className="mb-3 rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            Recuperamos la venta que estaba en curso.
            <span className="flex gap-3 text-sm"><button onClick={nueva} className="underline">Descartarla</button><button onClick={() => setRecuperada(false)} className="underline">Seguir con ella</button></span>
          </p>
        )}
        {aviso && <p role="status" className="mb-3 rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold flex justify-between gap-3">{aviso}<button onClick={() => setAviso("")} className="text-sm underline shrink-0">Cerrar</button></p>}
        {fallidas.length > 0 && (
          <div role="alert" className="mb-3 rounded-xl bg-alerta-soft text-alerta px-4 py-3">
            <p className="font-semibold">{fallidas.length} venta{fallidas.length === 1 ? "" : "s"} hecha{fallidas.length === 1 ? "" : "s"} sin internet {fallidas.length === 1 ? "no se ha podido" : "no se han podido"} registrar:</p>
            <ul className="mt-1 text-sm grid gap-1">{fallidas.map((v) => <li key={v.idem_key} className="flex flex-wrap justify-between gap-2"><span>{new Date(v.creado).toLocaleString("es-CO")} · {pesos(v.total)} · {v.error ?? `${v.aviso} (se reintenta sola)`}</span><span className="flex flex-wrap gap-3">{/no cubre el total/.test(v.error ?? "") && <button onClick={() => { reintentar(v.idem_key, true); void sincronizar(empresa).then(contar); }} className="underline font-semibold">Registrar con el precio de hoy</button>}<button onClick={() => { reintentar(v.idem_key); void sincronizar(empresa).then(contar); }} className="underline font-semibold">Reintentar</button><button onClick={() => descartar(v.idem_key)} className="underline">Ya la registré a mano</button></span></li>)}</ul>
          </div>
        )}
        <div className="relative">
          <label htmlFor="buscar" className="sr-only">Buscar producto o escanear código de barras (escribe 12* antes para llevar 12)</label>
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input id="buscar" ref={buscador} autoFocus value={q} onChange={(e) => escribir(e.target.value)} onKeyDown={teclaBuscador}
            placeholder={mult ? `${mult} × siguiente producto` : "Buscar o escanear"} autoComplete="off" spellCheck={false}
            className="w-full h-16 rounded-2xl bg-surface border-2 border-line focus:border-ink outline-none pl-13 pr-4 sm:pr-24 text-xl"
            style={{ paddingLeft: 52 }} />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">{buscando ? "Buscando…" : <kbd className="hidden sm:inline">F2</kbd>}</span>
        </div>
        {avisoBuscar && <p role="alert" className="mt-2 rounded-lg bg-alerta-soft text-alerta px-3 py-2 text-sm font-semibold">{avisoBuscar}</p>}
        {mult !== null && (
          <p role="status" className="mt-2 inline-flex items-center gap-2 rounded-lg bg-ink text-white px-3 py-1.5 text-sm font-semibold">
            Cantidad: <span className="num">{mult}</span> para el siguiente producto
            <button onClick={() => { setMult(null); buscador.current?.focus(); }} className="underline font-normal">Anular</button>
          </p>
        )}

        {res.length > 0 ? (
          <ul className="mt-3 bg-surface rounded-2xl border border-line divide-y divide-line overflow-hidden" role="listbox" aria-label="Resultados">
            {res.map((p, i) => <Fila key={p.id} p={p} activo={i === sel} onHover={() => setSel(i)} agregar={agregar} iva={responsableIva} />)}
          </ul>
        ) : q.trim() && !buscando ? (
          <p className="mt-6 text-muted">No hay productos con «{q.trim()}». Prueba con otra palabra o escanea el código.</p>
        ) : (
          <>
          {vencen.length > 0 && (
            <section className="mt-5" aria-label="Vender primero">
              <h2 className="font-cond text-lg" style={{ fontWeight: 700 }}>Ofrécelos primero <span className="text-muted font-normal text-base" style={{ fontWeight: 400 }}>· tienen lotes que vencen en menos de 60 días</span></h2>
              <ul role="listbox" aria-label="Vender primero" className="mt-2 bg-surface rounded-2xl border border-line divide-y divide-line overflow-hidden">
                {vencen.map((p) => <Fila key={p.id} p={p} activo={false} onHover={() => {}} agregar={agregar} iva={responsableIva} />)}
              </ul>
            </section>
          )}
          <div className="mt-6 hidden sm:grid sm:grid-cols-3 gap-3 text-sm text-muted">
            <p><kbd>F2</kbd> buscar o escanear</p>
            <p><kbd>↑</kbd> <kbd>↓</kbd> elegir · <kbd>Enter</kbd> agregar caja</p>
            <p><kbd>F9</kbd> cobrar · <kbd>Esc</kbd> volver</p>
            <p><kbd>12*</kbd> antes de escanear: lleva 12</p>
            <p>Clic en la cantidad para escribirla</p>
            <p><kbd>F4</kbd> poner en espera · <kbd>F6</kbd> recuperar</p>
          </div>
          </>
        )}
      </section>

      {/* La tirilla */}
      <aside id="venta" aria-label="Venta actual" className="tirilla rounded-t-2xl xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto pb-8 scroll-mt-4">
        {hecho ? (
          <Hecho hecho={hecho} control={ex.control.length > 0} impresora={impresora} cambiarImpresora={cambiarImpresora} nombreEmpresa={nombreEmpresa} nueva={nueva} pedido={cobrado} />
        ) : (
          <>
            <div className="px-6 pt-5 flex items-baseline justify-between">
              <h2 className="font-cond text-xl" style={{ fontWeight: 700 }}>Venta</h2>
              <span className="text-sm text-muted num">{totales.items} artículo{totales.items === 1 ? "" : "s"}</span>
            </div>
            <div className="px-6 pt-2 grid grid-cols-2 gap-2" role="group" aria-label="Guardar o recuperar">
              <button onClick={ponerEnEspera} disabled={!lineas.length} className={boton}>En espera <kbd className="hidden sm:inline">F4</kbd></button>
              <button onClick={() => setDialogo("lista")} className={boton}>Recuperar <kbd className="hidden sm:inline">F6</kbd></button>
              <button onClick={() => { setError(""); setDialogo("domicilio"); }} disabled={!lineas.length} className={boton}>Domicilio</button>
              <button onClick={() => { setError(""); setDialogo("cotizacion"); }} disabled={!lineas.length} className={boton}>Cotizar</button>
            </div>
            {pedido && (
              <div className="mx-6 mt-3 rounded-xl border border-line bg-paper px-4 py-2.5 flex items-start justify-between gap-3" aria-label="Pedido en la caja">
                <p className="min-w-0 text-sm leading-snug"><span className="font-semibold">{etiquetaPedido(pedido)}{pedido.estado === "en_camino" ? " · en camino" : pedido.estado === "vencido" ? " · vencida" : ""}</span>
                  {pedido.contacto && <span className="block text-muted">{pedido.contacto}{pedido.direccion ? ` · ${pedido.direccion}` : ""}</span>}</p>
                <button onClick={() => { setPedido(null); setAviso("El pedido quedó como estaba: esta es ahora una venta normal."); }} className="text-sm font-semibold underline shrink-0">Soltar</button>
              </div>
            )}
            <div className="px-6 pt-3" role="group" aria-label="Documento">
              {soloFactura ? (
                <p className="rounded-xl bg-paper px-3 py-2.5 text-sm"><b>Factura electrónica</b><span className="text-muted"> · esta droguería no tiene tiquete POS habilitado: cada venta lleva el cliente</span></p>
              ) : <div className="grid grid-cols-2 gap-1 rounded-xl bg-paper p-1">
                {([["pos", "Tiquete POS"], ["factura", "Factura electrónica"]] as const).map(([k, t]) => (
                  <button key={k} aria-pressed={tipoDoc === k} onClick={() => { setTipoDoc(k); if (k === "pos") setCredito(false); setError(""); }}
                    className={`h-10 rounded-lg text-sm font-semibold ${tipoDoc === k ? "bg-ink text-white" : "text-muted"}`}>{t}</button>
                ))}
              </div>}
            </div>
            {tipoDoc === "factura" && <ClienteFactura cliente={cliente} onCambio={(c) => { setCliente(c); setMotivoCredito(""); setError(""); }} total={Math.round(totales.total)} onCredito={setCred} gerencia={gerencia} />}
            {ofreceCredito && (
                  <div className="px-6 pt-3">
                    <p className="text-sm font-semibold mb-2">Forma de pago</p>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Forma de pago">
                      {([[false, "Contado"], [true, "Crédito"]] as const).map(([v, t]) => (
                        <button key={t} aria-pressed={credito === v} onClick={() => setCredito(v)}
                          className={`h-11 rounded-lg border-2 text-sm font-semibold ${credito === v ? "border-ink bg-ink text-white" : "border-line"}`}>{t}</button>
                      ))}
                    </div>
                    {credito && (
                      <div className="mt-3">
                        <p className="text-sm font-semibold mb-2">Plazo</p>
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Plazo de pago">
                          {PLAZOS.map((d) => (
                            <button key={d} aria-pressed={plazo === d} onClick={() => setPlazo(d)}
                              className={`h-9 px-3 rounded-lg border-2 text-sm font-semibold num ${plazo === d ? "border-ink bg-ink text-white" : "border-line"}`}>{d} días</button>
                          ))}
                        </div>
                        <p className="mt-2 text-sm text-muted">{cliente ? `${cliente.nombre} (${documento(cliente)})` : "El cliente"} paga a {plazo} días. Los abonos se registran en Cartera.</p>
                        {pideMotivo && (
                          <div className="mt-3 rounded-xl border-2 border-aviso bg-aviso-soft p-3">
                            <label htmlFor="motivo-credito" className="text-sm font-semibold">Motivo de la autorización</label>
                            <p id="motivo-credito-ayuda" className="text-[13px] text-muted">Fiar por encima de lo permitido queda a tu nombre, con este motivo, en la auditoría.</p>
                            <textarea id="motivo-credito" rows={2} maxLength={200} value={motivoCredito} aria-describedby="motivo-credito-ayuda"
                              onChange={(e) => { setMotivoCredito(e.target.value); setError(""); }} placeholder="Ej.: cliente de años, paga el viernes"
                              className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

            <div className="pb-3" />
            <div className="corte" />
            {lineas.length === 0 ? (
              <p className="px-6 py-10 text-muted text-center">Escanea o busca un producto para empezar.</p>
            ) : (
              <ul className="px-6 py-2 divide-y divide-dashed divide-line max-h-[46vh] xl:max-h-[max(9rem,calc(100dvh-36rem))] overflow-auto">
                {lineas.map((l) => (
                  <LineaVenta key={l.key} l={l} general={descGeneral} sobra={excede(lineas, l.p)} domicilio={domicilios[l.p.id]}
                    onCambio={(c) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...c } : x)))}
                    onQuitar={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} onListo={() => buscador.current?.focus()} />
                ))}
              </ul>
            )}
            {pide && <PanelFormula ex={ex} cfg={formulas} datos={formula} onCambio={setFormula} falta={faltaFormula} sinRed={formulaSinRed} />}
            {/* En PC la tirilla cabe en la ventana (las líneas se desplazan por dentro) y «Cobrar» queda a la vista. */}
            <div>
            <div className="corte" />
            <dl className="px-6 pt-3 text-sm text-muted num grid grid-cols-2 gap-y-1">
              {responsableIva ? <>
                <dt>Base</dt><dd className="text-right">{pesos(totales.base)}</dd>
                <dt>IVA</dt><dd className="text-right">{pesos(totales.iva)}</dd>
              </> : <><dt>No responsable de IVA</dt><dd className="text-right">{pesos(totales.total)}</dd></>}
              {totales.descuento > 0 && <><dt>Descuento</dt><dd className="text-right">−{pesos(totales.descuento)}</dd></>}
            </dl>
            {lineas.length > 0 && (
              <label className="px-6 pt-1 flex items-center justify-end gap-1.5 text-sm text-muted">Descuento general
                <input id="desc-general" inputMode="decimal" className="num w-14 h-8 rounded-lg border border-line px-2 text-right" value={descGeneral || ""} placeholder="0"
                  onChange={(e) => setDescGeneral(Math.min(99, Math.max(0, Number(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")) || 0)))} />%
              </label>
            )}
            <div className="px-6 pt-2 flex items-baseline justify-between">
              <span className="text-lg">Total</span>
              <span className="num font-cond text-[52px] leading-none tracking-tight" style={{ fontWeight: 700 }}>{pesos(totales.total)}</span>
            </div>

            {cobrando ? (
              <Cobro aCredito={aCredito} medio={medio} setMedio={setMedio} otro={otro} setOtro={setOtro} otroNum={otroNum} restante={restante} recibido={recibido} setRecibido={setRecibido}
                recibidoNum={recibidoNum} cambio={cambio} recibidoRef={recibidoRef} confirmar={confirmar} error={error} enviando={enviando} total={totales.total} tipoDoc={tipoDoc}
                volver={() => { setCobrando(false); buscador.current?.focus(); }} precios={preciosCambiados} />
            ) : (
              <div className="px-6 pt-5">
                {error && <p role="alert" className="mb-3 text-alerta text-sm">{error}</p>}
                <button disabled={!puedeCobrar} onClick={abrirCobro}
                  className="w-full h-16 rounded-xl bg-cruz text-cruz-ink text-xl font-semibold disabled:opacity-40 flex items-center justify-center gap-3">
                  Cobrar <kbd className="!bg-transparent !text-white/80 !border-white/40">F9</kbd>
                </button>
                <p className="mt-3 text-center text-[13px] text-muted">{lineas.some((l) => excede(lineas, l.p)) ? "Hay más de lo que queda en existencias: baja la cantidad o vende por unidad" : faltaCliente && lineas.length > 0 ? "Elige o crea el cliente para facturar" : faltaCorreo && lineas.length > 0 ? "Escribe el correo del cliente: la factura electrónica lo necesita" : descuentoExcedido ? `Tu descuento máximo es ${descuentoMax} % (contando el general): bájalo o pide autorización al dueño` : faltaMotivo && lineas.length > 0 ? "Escribe el motivo para fiar por encima del cupo" : formulaSinRed ? "Sin internet no se venden productos que exigen registrar la fórmula" : faltaFormula && lineas.length > 0 ? <>Completa la fórmula médica para cobrar · <kbd>F9</kbd> te lleva al dato que falta</> : `${tipoDoc === "factura" ? "Factura electrónica de venta" : "Tiquete POS electrónico"} · el lote que vence antes sale primero`}</p>
              </div>
            )}
            </div>
          </>
        )}
      </aside>
      {/* En pantallas pequeñas la tirilla queda abajo: barra fija con el total para no perderlo de vista. */}
      {!hecho && lineas.length > 0 && !cobrando && !dialogo && (
        <div className="xl:hidden fixed inset-x-0 bottom-0 z-30 bg-ink text-white px-4 py-3 [@media(max-height:500px)]:py-1.5 flex items-center gap-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <a href="#venta" className="flex-1 min-w-0">
            <span className="block text-sm text-white/70">{totales.items} artículo{totales.items === 1 ? "" : "s"} · ver venta</span>
            <span className="block num font-cond text-2xl leading-tight" style={{ fontWeight: 700 }}>{pesos(totales.total)}</span>
          </a>
          {(faltaFormula || formulaSinRed) && lineas.every((l) => !excede(lineas, l.p)) && !faltaCliente ? (
            <button onClick={irAFormula} className="h-12 px-4 rounded-xl bg-aviso-soft text-aviso font-semibold">Completar fórmula</button>
          ) : (
          <button disabled={!puedeCobrar} onClick={() => { setCobrando(true); document.getElementById("venta")?.scrollIntoView({ behavior: "smooth" }); setTimeout(() => recibidoRef.current?.focus(), 350); }}
            className="h-12 px-6 rounded-xl bg-cruz text-cruz-ink font-semibold text-lg disabled:opacity-40">Cobrar</button>
          )}
        </div>
      )}
      {dialogo === "lista" && <ListaPedidos actual={pedido?.id ?? null} onCerrar={() => { setDialogo(null); buscador.current?.focus(); }} onRecuperar={(id) => void recuperar(id)} />}
      {dialogo && dialogo !== "lista" && (
        <GuardarPedido tipo={dialogo} nombreEmpresa={nombreEmpresa} onCerrar={() => { setDialogo(null); buscador.current?.focus(); }}
          inicial={pedido && pedido.tipo === dialogo ? { contacto: pedido.contacto ?? "", telefono: pedido.telefono ?? "", direccion: pedido.direccion ?? "", nota: pedido.nota ?? "" } : { contacto: pedido?.contacto ?? cliente?.nombre ?? "", telefono: cliente?.telefono ?? "" }}
          guardar={(d) => guardarComo(dialogo, d)}
          onListo={(p, enCamino) => {
            setDialogo(null); nueva();
            setAviso(p.tipo === "espera" ? `Venta en ${etiquetaPedido(p).replace("En espera", "espera")}${p.contacto ? ` (${p.contacto})` : ""}. Recupérala con F6 desde cualquier caja.`
              : p.tipo === "domicilio" ? `${etiquetaPedido(p)} guardado${enCamino ? " y en camino" : ""}. Al volver el domiciliario, cóbralo con F6 o desde Pedidos.`
              : `${etiquetaPedido(p)} guardada. Se convierte en venta con F6 o desde Pedidos.`);
          }} />
      )}
    </div>
  );
}
