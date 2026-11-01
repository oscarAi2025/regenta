import { NextResponse } from "next/server";
import { z } from "zod";
import { comoUsuario, mensajeError, sinRLS } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { procesarCola } from "@/lib/dian";

const Venta = z.object({
  idem_key: z.string().uuid(),
  tipo_doc: z.enum(["pos", "factura"]),
  cliente_id: z.string().uuid().nullish(),
  lineas: z.array(z.object({ producto_id: z.string().uuid(), presentacion: z.enum(["caja", "unidad"]), cantidad: z.number().int().positive().max(10000) })).min(1).max(200),
  pagos: z.array(z.object({ medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b"]), valor: z.number().positive(), referencia: z.string().max(60).nullish() })).min(1).max(6),
});

/** Registra la venta (la base de datos fija precios, lotes y numeración) y dispara la emisión DIAN. */
export async function POST(req: Request) {
  const s = await leerSesion();
  if (!s) return NextResponse.json({ error: "Sesión vencida: vuelve a entrar" }, { status: 401 });
  const p = Venta.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos de la venta incompletos" }, { status: 400 });
  try {
    const caja = await comoUsuario(s, async (c) => (await c.query(`select id, sede_id from cajas where empresa_id = $1 and activa order by nombre limit 1`, [s.empresa])).rows[0]);
    if (!caja) return NextResponse.json({ error: "Esta empresa no tiene cajas activas" }, { status: 422 });
    const r = await comoUsuario(s, async (c) => (await c.query(`select registrar_venta($1) r`, [{ ...p.data, empresa_id: s.empresa, sede_id: caja.sede_id, caja_id: caja.id }])).rows[0].r);
    // Emisión inmediata en segundo plano lógico: si la DIAN tarda o falla, la venta ya está guardada y la cola reintenta.
    await procesarCola(3).catch((e) => console.error("cola DIAN", e));
    const doc = await sinRLS(async (c) => (await c.query(`select estado, cufe, qr, simulado, ultimo_error from documentos_dian where venta_id = $1`, [r.venta_id])).rows[0]);
    return NextResponse.json({ venta: r, documento: doc });
  } catch (e) {
    const { status, error } = mensajeError(e);
    return NextResponse.json({ error }, { status });
  }
}
