import { conControlEspecial } from "@/lib/control-plan";
import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { CAMPOS, PLANTILLA_BASE, validarPlantilla } from "@/lib/anexo13";
import { leerConfig, moduloListo } from "@/lib/anexo13-datos";

// Configuración del informe mensual de la droguería: departamento y Fondo Rotatorio, canal de envío, responsable y la
// plantilla de columnas (el formato exacto que pide su fondo). Dueño y administrador.

const NO_LISTO = { error: "La configuración del informe se está activando en tu Regenta: vuelve a intentarlo en unos minutos." };

export const GET = conSesion(conControlEspecial(async (s) => {
  if (!puede.verCostos(s.rol)) return json({ error: "La configuración la ven el dueño o el administrador" }, 403);
  const r = await comoUsuario(s, async (c) => ((await moduloListo(c)) ? await leerConfig(c, s.empresa) : null));
  if (!r) return json(NO_LISTO, 409);
  return json({ ...r, base: PLANTILLA_BASE, campos: Object.entries(CAMPOS).map(([campo, c]) => ({ campo, titulo: c.titulo })) });
}));

const opcional = (min: number, max: number, nombre: string) =>
  z.string().trim().max(max, `${nombre}: máximo ${max} caracteres`).refine((v) => v === "" || v.length >= min, `${nombre}: mínimo ${min} caracteres`).optional().default("");
const Config = z.object({
  departamento: opcional(3, 60, "Departamento"),
  fondo: opcional(3, 160, "Fondo Rotatorio"),
  canal: z.enum(["", "correo", "plataforma", "presencial", "otro"]).optional().default(""),
  destino: opcional(3, 200, "Correo o enlace de envío"),
  responsable: opcional(3, 120, "Responsable"),
  responsable_registro: opcional(2, 40, "Registro del responsable"),
  plantilla: z.unknown().optional(),
});

export const PUT = conSesion(conControlEspecial(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador cambian esta configuración" }, 403);
  const p = Config.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, 400);
  const { plantilla, ...datos } = p.data;
  let columnas: unknown = null; // null = plantilla base de Regenta
  if (plantilla != null) {
    const v = validarPlantilla(plantilla);
    if (!v.ok) return json({ error: v.error }, 400);
    columnas = v.plantilla;
  }
  const ok = await comoUsuario(s, async (c) => {
    if (!(await moduloListo(c))) return false;
    await c.query(`select configurar_anexo13($1, $2)`, [s.empresa, { ...datos, plantilla: columnas }]);
    return true;
  });
  return ok ? json({ ok: true }) : json(NO_LISTO, 409);
}));
