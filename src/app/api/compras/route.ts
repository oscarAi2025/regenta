import { z } from "zod";
import { comoUsuario, mensajeError, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { cajaElegida } from "@/lib/caja-elegida";
import { MEDIO_IDS, puedeCompras } from "@/lib/compras";
import { ProveedorNuevo, detalleCompra, errorConMensaje, listaCompras, proveedorId } from "@/lib/compras-datos";
import { dvNit, fechaReal } from "@/lib/validar";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida").refine(fechaReal, "Fecha no válida");
const dinero = (max: number, msg: string) => z.number().min(0).max(max, msg).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Máximo dos decimales");

const Compra = z.object({
  idem_key: z.string().max(80).nullish(),
  proveedor_id: z.string().uuid("Elige el proveedor").nullish(),
  proveedor_nuevo: ProveedorNuevo.nullish(),
  numero_factura: z.string().trim().min(1, "Escribe el número de la factura del proveedor").max(40, "El número de factura admite 40 caracteres"),
  fecha_factura: fecha,
  condicion: z.enum(["contado", "credito"]).default("contado"),
  vence_pago: fecha.nullish(),
  total_papel: dinero(10_000_000_000, "Revisa el total de la factura").nullish(),
  cufe_proveedor: z.string().trim().max(120).nullish(),
  observaciones: z.string().trim().max(300).nullish(),
  lineas: z.array(z.object({
    producto_id: z.string().uuid(),
    lote: z.string().trim().min(1, "Falta el lote").max(40),
    vence: fecha.nullish(),
    unidades: z.number().int("Las unidades van enteras").min(0).max(1_000_000),
    bonificadas: z.number().int("Las bonificadas van enteras").min(0).max(1_000_000).default(0),
    costo: dinero(100_000_000, "Revisa el costo").nullish(),
    costo_por: z.enum(["caja", "unidad"]).nullish(),
    descuento_pct: z.number().min(0).max(99.99, "El descuento debe ser menor que 100 %").nullish(),
    iva_pct: z.union([z.literal(0), z.literal(5), z.literal(19)]).nullish(),
    precio_venta_nuevo: z.number().int("El precio de venta va en pesos, sin centavos").positive().max(100_000_000).nullish(),
    precio_unidad_nuevo: z.number().int("El precio de venta va en pesos, sin centavos").positive().max(100_000_000).nullish(),
  }).refine((l) => l.unidades + l.bonificadas > 0, { message: "La cantidad no puede ser cero" })).min(1, "Agrega al menos un producto").max(500, "Máximo 500 líneas por compra"),
  // Cargada desde la factura del proveedor: el archivo guardado y los emparejamientos que se recuerdan para la próxima.
  archivo_id: z.string().uuid().nullish(),
  recordar: z.array(z.object({ clave: z.string().trim().min(1).max(200), producto_id: z.string().uuid(), como: z.enum(["caja", "unidad"]) })).max(1000).nullish(),
  // Compra de contado ya pagada: el pago se registra en la misma transacción.
  pago: z.object({ medio: z.enum(MEDIO_IDS), referencia: z.string().trim().max(60).nullish(), desde_caja: z.boolean().default(true) }).nullish(),
}).refine((c) => c.proveedor_id || c.proveedor_nuevo, { message: "Elige el proveedor", path: ["proveedor_id"] })
  .refine((c) => c.condicion === "contado" || !c.pago, { message: "Una compra a crédito se paga desde Cuentas por pagar", path: ["pago"] });

/** Lista de compras con filtros (dueño, administrador y bodega; la bodega sin dinero). */
export const GET = conSesion(async (s, req) => {
  if (!puedeCompras.ver(s.rol)) return json({ error: "Las compras las ven el dueño, el administrador o la bodega" }, 403);
  const sp = new URL(req.url).searchParams;
  const f = (k: string) => { const v = sp.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && fechaReal(v) ? v : undefined; };
  const estado = ["por_costear", "registrada", "anulada"].includes(sp.get("estado") ?? "") ? sp.get("estado")! : undefined;
  const proveedor = /^[0-9a-f-]{36}$/i.test(sp.get("proveedor") ?? "") ? sp.get("proveedor")! : undefined;
  const compras = await comoUsuario(s, (c) => listaCompras(c, s.empresa, { estado, proveedor, desde: f("desde"), hasta: f("hasta"), q: sp.get("q") ?? "" }, puedeCompras.dinero(s.rol)));
  return json({ compras });
});

/** Registrar una compra (recepción + factura). La gerencia con costos → registrada; la bodega → por costear. */
export const POST = conSesion(async (s, req) => {
  if (!puedeCompras.ver(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega registran compras" }, 403); // el permiso se mira antes que los datos
  const p = Compra.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos de la compra incompletos" }, 400);
  const { proveedor_nuevo, pago, archivo_id, recordar, ...d } = p.data;
  const gerencia = puedeCompras.dinero(s.rol);
  if (pago && !gerencia) return json({ error: "Los pagos los registra el dueño o el administrador" }, 403);
  const caja = await cajaElegida();
  try {
    const r = await comoUsuario(s, async (c) => {
      const puesto = await puestoDeTrabajo(c, s.empresa, caja);
      const prov = await proveedorId(c, s.empresa, d.proveedor_id, proveedor_nuevo ? { ...proveedor_nuevo, dv: proveedor_nuevo.nit ? dvNit(proveedor_nuevo.nit) : null } : null);
      const lineas = gerencia ? d.lineas : d.lineas.map(({ producto_id, lote, vence, unidades, bonificadas }) => ({ producto_id, lote, vence, unidades, bonificadas }));
      const k = (await c.query(`select registrar_compra($1) r`, [{ ...d, lineas, proveedor_id: prov, empresa_id: s.empresa, sede_id: puesto.sede_id }])).rows[0].r;
      if (!k.repetida) {
        if (archivo_id) await c.query(`select vincular_archivo_compra($1, $2, $3)`, [s.empresa, archivo_id, k.id]);
        if (recordar?.length) await c.query(`select recordar_productos_proveedor($1, $2, $3)`, [s.empresa, prov, JSON.stringify(recordar)]);
      }
      let pagoHecho = null;
      if (pago && !k.repetida && k.estado === "registrada" && Number(k.total) > 0) {
        pagoHecho = (await c.query(`select registrar_pago_proveedor($1) r`, [{ empresa_id: s.empresa, proveedor_id: prov, medio: pago.medio, valor: Number(k.total),
          referencia: pago.referencia ?? null, desde_caja: pago.desde_caja, caja_id: puesto.caja_id, compras: [k.id], idem_key: d.idem_key ? `${d.idem_key}:pago` : null }])).rows[0].r;
      }
      return { ...k, pago: pagoHecho, detalle: await detalleCompra(c, s.empresa, k.id, gerencia) };
    });
    return json(r, r.repetida ? 200 : 201);
  } catch (e) {
    const m = errorConMensaje(e) ?? mensajeError(e);
    return json({ error: m.error }, m.status);
  }
});
