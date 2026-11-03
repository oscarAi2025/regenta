// Importación de productos: columnas de otros sistemas, números, fechas, IVA, códigos de barras y duplicados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapearColumnas, numero, fecha, iva, codigoBarras, leerFilas } from "../src/lib/importar.ts";

test("reconoce columnas con los nombres de otros sistemas", () => {
  const m = mapearColumnas(["Código", "Descripción", "Laboratorio", "IVA %", "Precio Venta", "Existencia Actual", "Fecha Vto", "Lote", "Costo Promedio", "Valor Total", "Reg. INVIMA"]);
  assert.deepEqual(m, ["codigo_barras", "nombre", "laboratorio", "iva", "precio_caja", "cantidad_unidades", "vence", "lote", "costo_unidad", null, "registro_sanitario"]);
  // con columna de código de barras propia, «Código» (interno) no se toma
  assert.deepEqual(mapearColumnas(["Codigo", "EAN", "Producto", "PVP"]), [null, "codigo_barras", "nombre", "precio_caja"]);
  assert.deepEqual(mapearColumnas(["nombre", "codigo_barras", "precio_caja", "precio_unidad", "unidades_por_caja"]), ["nombre", "codigo_barras", "precio_caja", "precio_unidad", "unidades_por_caja"]);
});

test("números escritos de cualquier forma", () => {
  for (const [v, n] of [["12000", 12000], ["12.000", 12000], ["$ 24.000", 24000], ["1.300", 1300], ["12,000", 12000], ["12.000,50", 12000.5], ["1,234.56", 1234.56], ["0,19", 0.19], ["19%", 19], [7500, 7500], ["(5)", -5], ["", undefined]])
    assert.equal(numero(v), n, `«${v}»`);
  assert.ok(Number.isNaN(numero("doce mil")));
});

test("fechas de vencimiento", () => {
  assert.equal(fecha("2027-08-31"), "2027-08-31");
  assert.equal(fecha("31/08/2027"), "2027-08-31");
  assert.equal(fecha("31-08-27"), "2027-08-31");
  assert.equal(fecha("08/2027"), "2027-08-31");
  assert.equal(fecha("2028-02"), "2028-02-29");
  assert.equal(fecha(46630), "2027-08-31"); // número de serie de Excel
  assert.equal(fecha(new Date(Date.UTC(2027, 7, 31))), "2027-08-31");
  assert.equal(fecha("2027-02-31"), null);
  assert.equal(fecha(""), undefined);
});

test("IVA y códigos de barras", () => {
  assert.equal(iva("19%"), 19); assert.equal(iva("0,19"), 19); assert.equal(iva("Excluido"), 0); assert.equal(iva(""), 0); assert.equal(iva(5), 5); assert.equal(iva("16"), null);
  assert.deepEqual(codigoBarras(7702057000000), { ean: "7702057000000" });
  assert.deepEqual(codigoBarras("'7702057000000"), { ean: "7702057000000" });
  assert.equal(codigoBarras("7,70206E+12").ean, ""); assert.match(codigoBarras("7,70206E+12").aviso, /formato «Texto»/);
  assert.equal(codigoBarras("A-123").ean, "");
});

test("filas del mismo producto se unen; lotes repetidos se suman; nada se duplica", () => {
  const hoy = "2026-11-03";
  const l = leerFilas([
    { nombre: "Ibuprofeno 400 mg caja x 30", codigo_barras: "7701234567890", precio_caja: "15.900", unidades_por_caja: 30, precio_unidad: 600, lote: "A1", vence: "31/12/2027", cantidad_unidades: 60 },
    { nombre: "Ibuprofeno 400 mg caja x 30", codigo_barras: "7701234567890", precio_caja: "15.900", unidades_por_caja: 30, lote: "B2", vence: "30/06/2028", cantidad_unidades: 30 },
    { nombre: "Ibuprofeno 400 mg caja x 30", codigo_barras: "7701234567890", precio_caja: "15.900", lote: "A1", vence: "31/12/2027", cantidad_unidades: 10 },
    { nombre: "Ibuprofeno 400 mg caja x 30", codigo_barras: "7701234567890", precio_caja: "15.900" },
    { nombre: "Suero oral sabor fresa", precio_caja: "4500", cantidad_unidades: 12 },
    { nombre: "SUERO ORAL  sabor fresa", precio_caja: "4500", cantidad_unidades: 3, lote: "S9" },
    { nombre: "Gasa estéril", precio_caja: 2000, cantidad_unidades: -4 },
    { nombre: "Jarabe vencido", precio_caja: 9000, lote: "V1", vence: "2026-01-31", cantidad_unidades: 5 },
    {},
  ], hoy);
  assert.equal(l.errores.length, 0, JSON.stringify(l.errores));
  assert.equal(l.productos.length, 4);
  const ibu = l.productos[0];
  assert.deepEqual(ibu.lotes.map((x) => [x.lote, x.unidades]), [["A1", 70], ["B2", 30]]);
  assert.equal(ibu.precio_caja, 15900); assert.equal(ibu.precio_unidad, 600);
  const suero = l.productos[1];
  assert.deepEqual(suero.lotes.map((x) => [x.lote, x.unidades]), [["INICIAL", 12], ["S9", 3]]);
  assert.equal(l.productos[2].lotes.length, 0); // existencia negativa → 0
  assert.equal(l.productos[3].lotes.length, 0); // vencido → no se carga
  assert.ok(l.avisos.some((a) => a.fila === 5 && /se omite/.test(a.texto)));
  assert.ok(l.avisos.some((a) => a.fila === 8 && /negativa/.test(a.texto)));
  assert.ok(l.avisos.some((a) => a.fila === 9 && /vencido/.test(a.texto)));
});

test("errores que sí impiden importar, con la fila exacta", () => {
  const l = leerFilas([
    { nombre: "Producto sin precio" },
    { nombre: "x", precio_caja: 100 },
    { nombre: "IVA raro", precio_caja: 100, iva: 16 },
    { nombre: "Fecha rara", precio_caja: 100, vence: "pronto", cantidad_unidades: 1 },
    { nombre: "Lote con dos fechas", precio_caja: 100, lote: "Z", vence: "2027-01-31", cantidad_unidades: 1 },
    { nombre: "Lote con dos fechas", precio_caja: 100, lote: "Z", vence: "2028-01-31", cantidad_unidades: 1 },
    { nombre: "Media caja", precio_caja: 100, cantidad_unidades: "2,5" },
  ], "2026-11-03");
  assert.deepEqual(l.errores.map((e) => e.fila), [2, 3, 4, 5, 7, 8]);
  assert.match(l.errores[0].texto, /falta el precio de venta/);
});

test("solo precio por unidad: la caja de 1 unidad toma ese precio", () => {
  const l = leerFilas([{ nombre: "Curitas", precio_unidad: "300" }], "2026-11-03");
  assert.equal(l.productos[0].precio_caja, 300);
  assert.equal(l.productos[0].precio_unidad, null);
});
