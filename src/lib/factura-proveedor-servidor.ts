import "server-only";
import type { Tx } from "./db";
import { normalizarCodigo } from "./precios";
import { fichas, parecido, sinTildes, type DocumentoLeido, type LineaLeida } from "./factura-proveedor";

// Emparejar cada línea de la factura con el catálogo de la droguería (siempre dentro de su sesión, con RLS):
//  1. código de barras o código alterno exacto;  2. lo que esta droguería ya emparejó con ese proveedor;
//  3. por nombre, solo si hay certeza (puntaje alto y claramente mejor que el segundo). Si no, la persona elige.

export type ProductoCompra = {
  id: string; nombre: string; laboratorio: string | null; ean: string | null; unidades_por_caja: number; unidades: number;
  iva: number; precio_caja: number; precio_unidad: number | null; costo_unidad: number | null;
};
export type Emparejada = LineaLeida & {
  producto: ProductoCompra | null; por: "codigo" | "memoria" | "nombre" | null; como: "caja" | "unidad"; revisar_como: boolean;
  candidatos: (ProductoCompra & { puntaje: number })[]; claves: string[];
};

const COLS = `p.id, p.nombre, p.laboratorio, p.ean, p.unidades_por_caja, p.iva::float, p.precio_caja::float, p.precio_unidad::float,
  coalesce((select sum(unidades) from v_stock_vigente s where s.producto_id = p.id), 0)::int unidades`;

/** Claves con las que se recuerda una línea: su código del proveedor y su descripción limpia. */
export const clavesLinea = (l: Pick<LineaLeida, "codigo" | "nombre">) =>
  [l.codigo ? `cod:${normalizarCodigo(l.codigo).toLowerCase()}` : null, `txt:${fichas(l.nombre).join(" ")}`].filter((x): x is string => !!x && x.length > 4).map((x) => x.slice(0, 200));

/** Proveedor de la droguería por NIT (o por nombre exacto). */
export async function proveedorDeFactura(c: Tx, empresa: string, d: Pick<DocumentoLeido, "proveedor">) {
  const r = await c.query(`select id, nombre, nit, plazo_dias from proveedores where empresa_id = $1 and activo
     and (($2::text is not null and nit = $2) or lower(trim(nombre)) = lower(trim($3))) order by (nit = $2) desc nulls last limit 1`,
    [empresa, d.proveedor.nit, d.proveedor.nombre]);
  return (r.rows[0] ?? null) as { id: string; nombre: string; nit: string | null; plazo_dias: number | null } | null;
}

export async function emparejar(c: Tx, empresa: string, proveedor: string | null, lineas: LineaLeida[], dinero: boolean): Promise<Emparejada[]> {
  const conCosto = async (ps: ProductoCompra[]) => {
    if (!dinero || !ps.length) return ps;
    const k = await c.query(`select distinct on (l.producto_id) l.producto_id, lc.costo_unidad::float costo from lotes l join lote_costos lc on lc.lote_id = l.id
       where l.empresa_id = $1 and l.producto_id = any($2::uuid[]) order by l.producto_id, l.creado desc`, [empresa, ps.map((p) => p.id)]).catch(() => ({ rows: [] as { producto_id: string; costo: number }[] }));
    const m = new Map(k.rows.map((x: { producto_id: string; costo: number }) => [x.producto_id, x.costo]));
    return ps.map((p) => ({ ...p, costo_unidad: m.get(p.id) ?? null }));
  };

  // 1. Códigos exactos.
  const codigos = [...new Set(lineas.flatMap((l) => [l.ean, l.codigo]).filter((x): x is string => !!x).map(normalizarCodigo))];
  const porCodigo = new Map<string, ProductoCompra>();
  if (codigos.length) {
    const r = await c.query(`select ${COLS}, coalesce(array_agg(pc.codigo) filter (where pc.codigo is not null), '{}') codigos, null::float costo_unidad
       from productos p left join producto_codigos pc on pc.producto_id = p.id
       where p.empresa_id = $1 and p.activo and (p.ean = any($2) or pc.codigo = any($2)) group by p.id`, [empresa, codigos]);
    for (const p of r.rows) for (const k of [p.ean, ...p.codigos]) if (k && codigos.includes(normalizarCodigo(k))) porCodigo.set(normalizarCodigo(k), p);
  }
  // 2. Memoria de este proveedor.
  const memoria = new Map<string, { p: ProductoCompra; como: "caja" | "unidad" }>();
  if (proveedor) {
    const claves = lineas.flatMap(clavesLinea);
    const r = await c.query(`select pp.clave, pp.como, ${COLS}, null::float costo_unidad from proveedor_productos pp join productos p on p.id = pp.producto_id and p.activo
       where pp.empresa_id = $1 and pp.proveedor_id = $2 and pp.clave = any($3)`, [empresa, proveedor, claves]);
    for (const x of r.rows) memoria.set(x.clave, { p: x, como: x.como });
  }

  const salida: Emparejada[] = [];
  for (const l of lineas) {
    const claves = clavesLinea(l);
    if (l.cargo) { salida.push({ ...l, producto: null, por: null, como: "unidad", revisar_como: false, candidatos: [], claves }); continue; }
    let producto: ProductoCompra | null = null, por: Emparejada["por"] = null, como: "caja" | "unidad" | null = null;
    let candidatos: (ProductoCompra & { puntaje: number })[] = [];
    const cod = [l.ean, l.codigo].filter((x): x is string => !!x).map(normalizarCodigo).find((k) => porCodigo.has(k));
    if (cod) { producto = porCodigo.get(cod)!; por = "codigo"; }
    const mem = claves.map((k) => memoria.get(k)).find(Boolean);
    if (mem) { if (!producto) { producto = mem.p; por = "memoria"; } if (producto.id === mem.p.id) como = mem.como; }
    if (!producto) {
      // 3. Por nombre: candidatos que contengan alguna de las palabras más significativas, puntuados aquí.
      const ws = fichas(l.nombre).filter((w) => !/^\d/.test(w)).sort((a, b) => b.length - a.length).slice(0, 3);
      if (ws.length) {
        // Ordenados por cuántas palabras de la línea comparten (concentración incluida) ANTES del límite: con miles de
        // productos, «tableta» o «x100» traen cientos y el producto exacto quedaba por fuera de los 60.
        const pat = (w: string) => `%${w.replace(/[%_\\]/g, "")}%`;
        const todas = fichas(l.nombre).slice(0, 10).map(pat);
        const r = await c.query(`select ${COLS}, null::float costo_unidad from productos p
           cross join lateral (select regexp_replace(regexp_replace(sin_tildes(lower(p.nombre || ' ' || coalesce(p.laboratorio, ''))), '(\\d)[.,](\\d)', '\\1\\2', 'g'), '(\\d+)\\s*(mg|ml|g|gr|mcg|ui|%)\\y', '\\1\\2', 'g') t) x
           where p.empresa_id = $1 and p.activo and x.t like any ($2::text[])
           order by (select count(*) from unnest($3::text[]) w where x.t like w) desc, length(p.nombre) limit 60`, [empresa, ws.map(pat), todas]);
        candidatos = r.rows.map((p: ProductoCompra) => ({ ...p, puntaje: parecido(l.nombre, p) })).filter((p: { puntaje: number }) => p.puntaje >= 0.3)
          .sort((a: { puntaje: number }, b: { puntaje: number }) => b.puntaje - a.puntaje).slice(0, 4);
        const [a, b] = candidatos;
        if (a && a.puntaje >= 0.75 && (!b || a.puntaje - b.puntaje >= 0.15)) { producto = a; por = "nombre"; }
      }
    }
    if (producto) [producto] = await conCosto([producto]);
    // ¿La cantidad de la factura son cajas o unidades? Lo recordado manda; si no, el costo conocido del producto.
    let revisar = false;
    if (!como) {
      const upc = producto?.unidades_por_caja ?? 1;
      if (upc <= 1) como = "unidad";
      else if (/\b(UND|UNIDAD(ES)?|SUELT[AO]S?|TAB(LETA)?S?\s+SUELTAS?)\b/i.test(l.descripcion) && !/\bX\s*\d+/i.test(l.descripcion)) como = "unidad";
      else if (producto?.costo_unidad && l.precio) {
        const dCaja = Math.abs(l.precio - producto.costo_unidad * upc) / (producto.costo_unidad * upc), dUnd = Math.abs(l.precio - producto.costo_unidad) / producto.costo_unidad;
        como = dUnd < dCaja ? "unidad" : "caja"; revisar = Math.min(dCaja, dUnd) > 0.5;
      } else { como = "caja"; revisar = true; }
    }
    salida.push({ ...l, producto, por, como, revisar_como: revisar, candidatos: producto ? [] : candidatos, claves });
  }
  return salida;
}

/** Texto plano para buscar (sin tildes, minúsculas): lo usa la prueba de emparejamiento. */
export const normalTexto = (s: string) => sinTildes(s).replace(/\s+/g, " ").trim();
