import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { CATEGORIAS } from "@/lib/anexo13";
import { moduloListo, productosAnexo } from "@/lib/anexo13-datos";

// Ficha de cada medicamento de control especial (DCI, concentración, forma farmacéutica, CUM y listado de la
// Res. 315/2020): lo que pide el informe mensual. Dueño y administrador.

const NO_LISTO = { error: "Las fichas se están activando en tu Regenta: vuelve a intentarlo en unos minutos." };

export const GET = conSesion(async (s) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Las fichas de control especial las ven el dueño o el administrador" }, 403);
  const r = await comoUsuario(s, async (c) => ((await moduloListo(c)) ? await productosAnexo(c, s.empresa) : null));
  return r ? json({ productos: r, categorias: CATEGORIAS }) : json(NO_LISTO, 409);
});

const texto = (max: number, msg: string) => z.string().trim().max(max, msg).optional().default("");
const Ficha = z.object({
  producto_id: z.string().uuid("Producto no válido"),
  principio_activo: texto(160, "El principio activo admite hasta 160 caracteres"),
  concentracion: texto(80, "La concentración admite hasta 80 caracteres"),
  forma_farmaceutica: texto(80, "La forma farmacéutica admite hasta 80 caracteres"),
  cum: z.string().trim().max(20).optional().default("")
    .refine((v) => v === "" || /^[0-9]{1,12}(-[0-9]{1,4})?$/.test(v.replace(/[^0-9-]/g, "")), "El CUM va como expediente-consecutivo, por ejemplo 19912345-01"),
  categoria: z.string().trim().optional().default("").refine((v) => v === "" || (CATEGORIAS as readonly string[]).includes(v), "Elige el listado de la lista"),
});

export const PUT = conSesion(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador cambian las fichas" }, 403);
  const p = Ficha.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, 400);
  const { producto_id, ...ficha } = p.data;
  const ok = await comoUsuario(s, async (c) => {
    if (!(await moduloListo(c))) return null;
    // Solo productos del control especial de esta droguería (la función revisa además el rol y la empresa).
    const es = (await productosAnexo(c, s.empresa)).some((x) => x.id === producto_id);
    if (!es) return false;
    await c.query(`select guardar_ficha_control($1, $2)`, [producto_id, ficha]);
    return true;
  });
  if (ok === null) return json(NO_LISTO, 409);
  if (!ok) return json({ error: "Ese producto no está marcado como control especial" }, 404);
  return json({ ok: true });
});
