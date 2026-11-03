import { z } from "zod";
import { puede } from "@/lib/sesion";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { fechaReal } from "@/lib/validar";

const Entrada = z.object({
  tipo: z.enum(["compra", "ajuste", "inicial"]),
  motivo: z.string().trim().max(200).nullish(),
  proveedor: z.string().trim().max(160).nullish(),   // compra: proveedor (se crea en la lista si es nuevo)
  factura: z.string().trim().max(40).nullish(),      // compra: número de la factura del proveedor
  idem_key: z.string().max(80).nullish(),
  lineas: z.array(z.object({
    producto_id: z.string().uuid(),
    lote: z.string().trim().min(1, "Falta el lote").max(40),
    vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(fechaReal, "Fecha de vencimiento no válida").nullish(),
    unidades: z.number().int().min(-1_000_000).max(1_000_000, "Máximo 1.000.000 de unidades por línea").refine((n) => n !== 0, "La cantidad no puede ser cero"),
    costo_unidad: z.number().min(0).max(100_000_000, "Revisa el costo por unidad").nullish(),
  })).min(1).max(500),
});

/** Recibir mercancía o ajustar inventario (la función de la base de datos valida rol, motivo y negativos). */
export const POST = conSesion(async (s, req) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega mueven inventario" }, 403); // el permiso se mira antes que los datos
  const p = Entrada.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  const { proveedor, factura, ...d } = p.data;
  const r = await comoUsuario(s, async (c) => {
    const sede = { id: (await puestoDeTrabajo(c, s.empresa)).sede_id };
    let motivo = d.motivo ?? null;
    if (d.tipo === "compra" && (proveedor || factura)) {
      // El proveedor queda en la lista de la droguería (sin duplicar por mayúsculas) y en el movimiento con su factura.
      if (proveedor && proveedor.length >= 2) await c.query(`insert into proveedores (empresa_id, nombre) values ($1, $2) on conflict (empresa_id, lower(trim(nombre))) do nothing`, [s.empresa, proveedor]);
      motivo = [proveedor ? `Proveedor: ${proveedor}` : null, factura ? `Factura: ${factura}` : null].filter(Boolean).join(" · ");
    }
    return (await c.query(`select registrar_entrada($1) r`, [{ ...d, motivo, empresa_id: s.empresa, sede_id: sede.id }])).rows[0].r;
  });
  return json(r, 201);
});
