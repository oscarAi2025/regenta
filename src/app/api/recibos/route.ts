import { z } from "zod";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { cajaElegida } from "@/lib/caja-elegida";
import { permisoCartera } from "@/lib/cartera";
import { claveIdem, idempotente } from "@/lib/idem";

/** Clientes con saldo pendiente (para recibir un pago en la caja), buscando por nombre o documento. */
export const GET = conSesion(async (s, req) => {
  if (!permisoCartera.recibir(s.rol)) return json({ error: "No tienes permiso para recibir pagos" }, 403);
  const q = (new URL(req.url).searchParams.get("q") ?? "").replace(/\0/g, "").trim().slice(0, 80);
  const clientes = await comoUsuario(s, async (c) => (await c.query(
    `select cliente_id id, nombre, documento, telefono, saldo::float, facturas, dias_mora from deudores($1, $2)`, [s.empresa, /^[\d.\s-]+$/.test(q) ? q.replace(/[.\s-]/g, "") : q])).rows);
  return json({ clientes });
});

const Pago = z.object({
  cliente_id: z.string().uuid("Elige el cliente"),
  medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b", "qr"], { message: "Elige el medio de pago" }),
  valor: z.number().int("El pago va en pesos, sin centavos").positive("Escribe el valor del pago").max(1_000_000_000, "Revisa el valor del pago"),
  referencia: z.string().trim().max(60, "La referencia va hasta 60 caracteres").nullish(),
  /** Opcional: aplicar el pago solo a esta factura (abono desde Cartera). Sin ella, se reparte desde la que vence primero. */
  venta_id: z.string().uuid("La factura no es válida").nullish(),
});

/** Recibo de caja: el pago se reparte entre las facturas del cliente (la que vence antes primero). La cajera necesita su
 *  turno abierto; el efectivo entra al turno de la caja de esta computadora. */
export const POST = conSesion(async (s, req) => {
  if (!permisoCartera.recibir(s.rol)) return json({ error: "No tienes permiso para recibir pagos" }, 403);
  const cuerpo = await req.json().catch(() => null);
  const p = Pago.safeParse(cuerpo);
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos del pago incompletos" }, 400);
  const caja = await cajaElegida();
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from clientes where id = $1 and empresa_id = $2`, [p.data.cliente_id, s.empresa])).rowCount) return null;
    const puesto = await puestoDeTrabajo(c, s.empresa, caja);
    return idempotente(c, s.empresa, claveIdem(cuerpo?.idem_key), async () =>
      (await c.query(`select registrar_recibo($1, $2, $3, $4, $5, $6) r`, [p.data.cliente_id, p.data.medio, p.data.valor, p.data.referencia ?? null, puesto.caja_id, p.data.venta_id ?? null])).rows[0].r);
  });
  if (!r) return json({ error: "Ese cliente no existe en tu droguería" }, 404);
  return json({ recibo: { ...r, valor: Number(r.valor), saldo: Number(r.saldo), saldo_anterior: Number(r.saldo_anterior) } }, 201);
});
