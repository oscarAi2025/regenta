import { z } from "zod";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { cajaElegida } from "@/lib/caja-elegida";
import { csv } from "@/lib/reportes";
import { carteraPorCliente, esEdad, permisoCartera } from "@/lib/cartera";

/** Cartera por cliente con edades (JSON, o CSV para Excel con ?formato=csv). Dueño o administrador. */
export const GET = conSesion(async (s, req) => {
  if (!permisoCartera.gestionar(s.rol)) return json({ error: "Solo el dueño o el administrador ven la cartera" }, 403);
  const sp = new URL(req.url).searchParams;
  const edad = sp.get("edad"), q = sp.get("q") ?? "";
  if (edad && !esEdad(edad)) return json({ error: "Edad no válida" }, 400);
  const filas = await comoUsuario(s, (c) => carteraPorCliente(c, s.empresa, esEdad(edad) ? edad : null, q));
  if (sp.get("formato") !== "csv") return json({ clientes: filas });
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const cuerpo = csv(filas.map((f) => ({ ...f, cupo: f.cupo ?? "", bloqueado: f.bloqueado ? "sí" : "no" })), [
    ["cliente", "Cliente"], ["documento", "Documento"], ["telefono", "Teléfono"], ["facturas", "Facturas"], ["saldo", "Saldo"],
    ["e0", "0-30 días"], ["e31", "31-60 días"], ["e61", "61-90 días"], ["e91", "Más de 90 días"], ["mora", "Mora máxima (días)"], ["cupo", "Cupo"], ["bloqueado", "Crédito bloqueado"]]);
  return new Response(cuerpo, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="regenta-cartera-${hoy}.csv"`, "cache-control": "no-store" } });
});

const Abono = z.object({
  venta_id: z.string().uuid(),
  medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b", "qr"]),
  valor: z.number().int("El abono va en pesos, sin centavos").positive("Escribe el valor del abono").max(1_000_000_000, "Revisa el valor del abono"),
  referencia: z.string().trim().max(60).nullish(),
});

/** Registrar un abono a una factura a crédito (la base de datos comprueba rol y saldo). Queda en la caja de esta
 *  computadora y, si tiene turno abierto, en ese turno. */
export const POST = conSesion(async (s, req) => {
  if (!puede.cartera(s.rol)) return json({ error: "Solo el dueño o el administrador registran abonos" }, 403);
  const p = Abono.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos del abono incompletos" }, 400);
  const caja = await cajaElegida();
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from ventas where id = $1 and empresa_id = $2`, [p.data.venta_id, s.empresa])).rowCount) return null;
    const puesto = await puestoDeTrabajo(c, s.empresa, caja);
    return (await c.query(`select registrar_abono($1, $2, $3, $4, $5) r`, [p.data.venta_id, p.data.medio, p.data.valor, p.data.referencia ?? null, puesto.caja_id])).rows[0].r;
  });
  if (!r) return json({ error: "Esa venta no existe en tu droguería" }, 404);
  return json(r, 201);
});

/** Bloquear el fiado a quien tenga una factura con más de N días de mora (null = no bloquea). Dueño o administrador. */
export const PATCH = conSesion(async (s, req) => {
  if (!permisoCartera.gestionar(s.rol)) return json({ error: "Solo el dueño o el administrador cambian esta opción" }, 403);
  const p = z.object({ dias_mora_bloqueo: z.number().int("Escribe los días en número entero").min(0, "Los días van de 0 a 365").max(365, "Los días van de 0 a 365").nullable() })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Escribe los días de mora" }, 400);
  await comoUsuario(s, (c) => c.query(`select configurar_mora($1, $2)`, [s.empresa, p.data.dias_mora_bloqueo]));
  return json({ dias_mora_bloqueo: p.data.dias_mora_bloqueo, mensaje: p.data.dias_mora_bloqueo === null ? "Listo: la mora no bloquea el fiado" : `Listo: con más de ${p.data.dias_mora_bloqueo} días de mora no se fía` });
});
