import "server-only";
import type { Tx } from "./db";
import type { Rango } from "./reportes";

// Libro de control especial: dispensaciones (venta con fórmula, por lote) y reintegros (anulaciones y devoluciones de
// esas ventas), con el saldo de cada producto en el periodo para cuadrar contra el inventario físico.
// Fechas en zona Bogotá, ambas incluidas. Solo dueño y administrador (lo exigen la ruta y la seguridad por fila).

export type FilaLibro = {
  id: string; tipo: "dispensacion" | "reintegro"; fecha: string; producto_id: string; producto: string; lote: string | null; vence: string | null;
  salida: number; reintegro: number; paciente_tipo_doc: string; paciente_doc: string; paciente_nombre: string;
  medico_nombre: string; medico_registro: string; formula_numero: string; formula_fecha: string;
  venta_id: string; venta: string; usuario: string; motivo: string | null;
};
export type SaldoProducto = {
  id: string; nombre: string; unidades_por_caja: number; control_especial: boolean;
  inicial: number; entradas: number; salidas: number; final: number; vendidas: number; dispensado: number; reintegrado: number; sin_registro: number;
};

export async function datosLibro(c: Tx, empresa: string, r: Rango, producto: string | null) {
  // Productos del libro: los marcados hoy y los que tuvieron dispensaciones de control especial (aunque se desmarquen).
  const productos = (await c.query(`select p.id, p.nombre, p.unidades_por_caja, p.control_especial from productos p
    where p.empresa_id = $1 and (p.control_especial or exists (select 1 from venta_formulas f where f.producto_id = p.id and f.control))
    order by p.nombre`, [empresa])).rows as { id: string; nombre: string; unidades_por_caja: number; control_especial: boolean }[];
  const elegido = producto && productos.some((p) => p.id === producto) ? producto : null;
  const ids = elegido ? [elegido] : productos.map((p) => p.id);

  const filas = (await c.query(`select l.id, l.tipo, to_char(l.fecha at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, l.producto_id, p.nombre producto,
      lo.lote, lo.vence::text vence, l.salida, l.reintegro, l.paciente_tipo_doc, l.paciente_doc, l.paciente_nombre, l.medico_nombre, l.medico_registro,
      l.formula_numero, l.formula_fecha::text formula_fecha, l.venta_id, l.prefijo || l.numero venta, split_part(coalesce(m.nombre, ''), ' (', 1) usuario, l.motivo
    from v_libro_control l
    join productos p on p.id = l.producto_id
    left join lotes lo on lo.id = l.lote_id
    left join miembros m on m.user_id = l.usuario_id and m.empresa_id = l.empresa_id
    where l.empresa_id = $1 and (l.fecha at time zone 'America/Bogota')::date between $2::date and $3::date and l.producto_id = any($4::uuid[])
    order by l.fecha, l.tipo, l.id limit 20000`, [empresa, r.desde, r.hasta, ids])).rows as FilaLibro[];

  const mov = (await c.query(`select p.id,
      coalesce(sum(m.cantidad) filter (where m.d < $2::date), 0)::int inicial,
      coalesce(sum(m.cantidad) filter (where m.cantidad > 0 and m.d between $2::date and $3::date), 0)::int entradas,
      coalesce(-sum(m.cantidad) filter (where m.cantidad < 0 and m.d between $2::date and $3::date), 0)::int salidas,
      coalesce(sum(m.cantidad) filter (where m.d <= $3::date), 0)::int final,
      coalesce(-sum(m.cantidad) filter (where m.tipo = 'venta' and m.d between $2::date and $3::date), 0)::int vendidas
    from productos p
    left join lateral (select x.cantidad, x.tipo, (x.creado at time zone 'America/Bogota')::date d from movimientos x where x.producto_id = p.id and x.empresa_id = $1) m on true
    where p.empresa_id = $1 and p.id = any($4::uuid[])
    group by p.id`, [empresa, r.desde, r.hasta, ids])).rows as { id: string; inicial: number; entradas: number; salidas: number; final: number; vendidas: number }[];

  const saldos: SaldoProducto[] = productos.filter((p) => ids.includes(p.id)).map((p) => {
    const m = mov.find((x) => x.id === p.id) ?? { inicial: 0, entradas: 0, salidas: 0, final: 0, vendidas: 0 };
    const dispensado = filas.filter((f) => f.producto_id === p.id).reduce((a, f) => a + f.salida, 0);
    const reintegrado = filas.filter((f) => f.producto_id === p.id).reduce((a, f) => a + f.reintegro, 0);
    return { ...p, ...m, dispensado, reintegrado, sin_registro: Math.max(0, m.vendidas - dispensado) };
  });
  return { productos, elegido, filas, saldos };
}

export const TIPO_LIBRO = { dispensacion: "Dispensación", reintegro: "Reintegro" } as const;

export const COLUMNAS_LIBRO: [string, string][] = [
  ["fecha", "Fecha"], ["movimiento", "Movimiento"], ["producto", "Producto"], ["lote", "Lote"], ["vence", "Vence"], ["salida", "Salida (unidades)"],
  ["reintegro", "Reintegro (unidades)"], ["paciente_tipo_doc", "Tipo de documento"], ["paciente_doc", "Documento del paciente"], ["paciente_nombre", "Paciente"],
  ["medico_nombre", "Médico"], ["medico_registro", "Registro profesional"], ["formula_numero", "N.º de fórmula"], ["formula_fecha", "Fecha de la fórmula"],
  ["venta", "Venta"], ["usuario", "Usuario"], ["motivo", "Observación"],
];
export const COLUMNAS_SALDOS: [string, string][] = [
  ["nombre", "Producto"], ["inicial", "Saldo inicial"], ["entradas", "Entradas"], ["salidas", "Salidas"], ["final", "Saldo final"],
  ["dispensado", "Dispensado con fórmula"], ["reintegrado", "Reintegrado"], ["sin_registro", "Vendido sin registro en el libro"],
];
export const filaCsv = (f: FilaLibro) => ({ ...f, movimiento: TIPO_LIBRO[f.tipo], salida: f.salida || null, reintegro: f.reintegro || null });
