import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { certificado, cuentaPrincipal, ErrorMatias, iniciarPruebas, matiasConfigurado, registrarSoftware, resoluciones, sincronizarNumeraciones, softwares } from "@/lib/dian/matias-cuenta";

// Habilitación DIAN de un cliente desde la consola, contra MATIAS: estado (certificado, software, set de pruebas,
// numeraciones en MATIAS), registrar el software que asignó la DIAN, lanzar el set de pruebas, sincronizar numeraciones y
// conectar la droguería a la cuenta principal (Farmagenéricos: mismo NIT que la casa de software).

const Accion = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("principal") }),
  z.object({ accion: z.literal("software"), tipo: z.union([z.literal(1), z.literal(3), z.literal(4)]),
    identificacion: z.string().trim().uuid("El ID del software de la DIAN tiene el formato 96ab0f7c-2ab0-…"),
    pin: z.string().trim().regex(/^\d{5}$/, "El PIN del software son 5 dígitos"),
    testsetid: z.string().trim().uuid("El TestSetId de la DIAN tiene el formato 6142be76-4d36-…") }),
  z.object({ accion: z.literal("pruebas"), software: z.number().int().positive() }),
  z.object({ accion: z.literal("sincronizar"), tipo: z.union([z.literal(1), z.literal(3), z.literal(4)]) }),
]);

async function empresa(id: string) {
  return (await sinRLS((c) => c.query(`select nit, demo, matias_cliente::text cliente from empresas where id = $1`, [id]))).rows[0] as { nit: string; demo: boolean; cliente: string | null } | undefined;
}
const fallo = (e: unknown) => {
  if (e instanceof ErrorMatias) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
};

export const GET = conAdmin(async (_a, _req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const e = await empresa(id);
  if (!e || e.demo) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!matiasConfigurado()) return NextResponse.json({ configurado: false });
  try {
    const p = await cuentaPrincipal();
    const base = { configurado: true, principal: { nit: p.nit, nombre: p.nombre, es_este: !!e.cliente && e.cliente === p.uuid, mismo_nit: String(e.nit) === p.nit }, conectado: !!e.cliente };
    if (!e.cliente) return NextResponse.json(base);
    const [cert, sw, res] = await Promise.all([certificado(e.cliente), softwares(e.cliente), resoluciones(e.cliente)]);
    return NextResponse.json({ ...base, certificado: cert, software: sw, resoluciones: res });
  } catch (x) { return fallo(x); }
});

export const POST = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Accion.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, { status: 400 });
  const e = await empresa(id);
  if (!e || e.demo) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!matiasConfigurado()) return NextResponse.json({ error: "El servidor está en modo simulado (REGENTA_DIAN no es «matias» o falta MATIAS_TOKEN)" }, { status: 409 });
  const d = p.data;
  try {
    if (d.accion === "principal") {
      // Solo la empresa con el mismo NIT que la cuenta principal puede facturar con ella.
      const pr = await cuentaPrincipal();
      if (String(e.nit) !== pr.nit) return NextResponse.json({ error: `El NIT de este cliente (${e.nit}) no es el de la cuenta principal de MATIAS (${pr.nit}): conéctalo con su propio UUID de cliente` }, { status: 409 });
      await sinRLS(async (c) => {
        await c.query(`update empresas set matias_cliente = $2 where id = $1 and not demo`, [id, pr.uuid]);
        await evento(a, "matias_cuenta_principal", id, { nit: pr.nit }, c);
      });
      return NextResponse.json({ ok: true, mensaje: `Conectado a la cuenta principal de MATIAS (${pr.nombre}, NIT ${pr.nit})` });
    }
    if (!e.cliente) return NextResponse.json({ error: "Primero conecta el cliente en MATIAS (su UUID o la cuenta principal)" }, { status: 409 });
    if (d.accion === "software") {
      const sid = await registrarSoftware(e.cliente, { tipo: d.tipo, identificacion: d.identificacion, pin: d.pin, testsetid: d.testsetid });
      await evento(a, "matias_registrar_software", id, { tipo: d.tipo, identificacion: d.identificacion, software: sid });
      return NextResponse.json({ ok: true, software: sid, mensaje: "Software registrado en MATIAS. Ahora inicia el set de pruebas" });
    }
    if (d.accion === "pruebas") {
      // El software tiene que ser de este cliente (MATIAS lo comprueba también: 404 si no es suyo).
      const sw = (await softwares(e.cliente)).find((s) => s.id === d.software);
      if (!sw) return NextResponse.json({ error: "Ese software no es de este cliente" }, { status: 404 });
      if (!sw.identificacion) return NextResponse.json({ error: "Primero registra el ID, el PIN y el TestSetId que dio la DIAN para ese software" }, { status: 409 });
      const m = await iniciarPruebas(e.cliente, d.software);
      await evento(a, "matias_set_pruebas", id, { software: d.software });
      return NextResponse.json({ ok: true, mensaje: `${m}. Tarda unos minutos: pulsa «Actualizar» para ver el resultado` });
    }
    const m = await sincronizarNumeraciones(e.cliente, d.tipo);
    await evento(a, "matias_sincronizar_numeraciones", id, { tipo: d.tipo });
    return NextResponse.json({ ok: true, mensaje: m });
  } catch (x) { return fallo(x); }
});
