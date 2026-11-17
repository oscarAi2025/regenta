// Control especial · Anexo 13 y libro completo: lógica pura (periodos, clasificación, saldo corrido, consolidado con
// ceros, plantilla configurable, revisión antes de exportar).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mesValido, limitesMes, mesAnterior, nombreMes, plazo, clasificar, libroConSaldo, consolidar, totales,
  PLANTILLA_BASE, CAMPOS, validarPlantilla, aplicarPlantilla, revisarInforme, detiene, observacion, CATEGORIAS,
} from "../src/lib/anexo13.ts";

const ficha = { principio_activo: "Acetaminofén + codeína", concentracion: "325 mg + 30 mg", forma_farmaceutica: "Tableta", cum: "19912345-01", categoria: CATEGORIAS[0] };
const prod = (id, extra = {}) => ({ id, nombre: `Producto ${id}`, laboratorio: "Lab", registro_sanitario: "INVIMA 2020M-0001", unidades_por_caja: 10, control_especial: true, ficha, ...extra });
const ctx = { periodo: "octubre de 2026", departamento: "Tolima", droguería: "Droguería Prueba", nit: "900123456-1", sede: "Principal" };

test("periodos: mes válido, límites (bisiesto y diciembre), mes anterior y nombre", () => {
  assert.ok(mesValido("2026-10")); assert.ok(!mesValido("2026-13")); assert.ok(!mesValido("2026-1")); assert.ok(!mesValido(null));
  assert.deepEqual(limitesMes("2028-02"), { desde: "2028-02-01", hasta: "2028-02-29" });
  assert.deepEqual(limitesMes("2026-12"), { desde: "2026-12-01", hasta: "2026-12-31" });
  assert.equal(mesAnterior("2026-01-05"), "2025-12");
  assert.equal(mesAnterior("2026-11-17"), "2026-10");
  assert.equal(nombreMes("2026-10"), "octubre de 2026");
});

test("plazo del día 10: días restantes y vencido", () => {
  assert.deepEqual(plazo("2026-11-03"), { periodo: "2026-10", vence: "2026-11-10", dia: 3, diasRestantes: 7, vencido: false });
  assert.equal(plazo("2026-11-10").vencido, false);
  assert.equal(plazo("2026-11-11").vencido, true);
  assert.equal(plazo("2026-01-01").periodo, "2025-12");
});

test("clasificación de movimientos de inventario para el libro", () => {
  assert.equal(clasificar("compra", 50, false), "entrada");
  assert.equal(clasificar("compra", -50, false), "anulacion_compra");
  assert.equal(clasificar("inicial", 20, false), "inicial");
  assert.equal(clasificar("venta", -2, true), "dispensacion");
  assert.equal(clasificar("venta", -2, false), "salida_sin_formula");
  assert.equal(clasificar("anulacion", 2, true), "reintegro");
  assert.equal(clasificar("devolucion", 1, true), "reintegro");
  assert.equal(clasificar("devolucion", -5, false), "devolucion_proveedor");
  assert.equal(clasificar("ajuste", -3, false), "ajuste_salida");
  assert.equal(clasificar("ajuste", 3, false), "ajuste_entrada");
});

test("libro con saldo corrido por producto, en orden de fecha (desempate por id)", () => {
  const m = (id, fecha, producto_id, tipo, cantidad, con_formula = false) => ({ id, fecha, producto_id, tipo, cantidad, con_formula, lote: "L1", vence: null, soporte: null, formula_numero: null, medico: null, paciente: null, usuario: null });
  const l = libroConSaldo([
    m("3", "2026-10-05 10:00", "A", "venta", -2, true),
    m("1", "2026-10-01 09:00", "A", "compra", 30),
    m("2", "2026-10-01 09:00", "B", "compra", 5),
    m("4", "2026-10-06 11:00", "A", "anulacion", 2, true),
  ], { A: 10 });
  assert.deepEqual(l.map((x) => [x.id, x.asiento, x.entrada, x.salida, x.saldo]), [
    ["1", "entrada", 30, 0, 40], ["2", "entrada", 5, 0, 5], ["3", "dispensacion", 0, 2, 38], ["4", "reintegro", 2, 0, 40],
  ]);
});

test("consolidado: saldo inicial + entradas − salidas = final; sin movimiento va en ceros", () => {
  const f = consolidar([prod("A"), prod("B"), prod("C")], {
    A: { inicial: 100, entradas: 50, salidas: 30, dispensado: 28, sin_formula: 2, formulas: 9, reintegros: 1, bajas: 3 },
    B: { inicial: 12 },
  }, { A: "L1 (vence 12/2027): 120" });
  assert.deepEqual(f.map((x) => [x.id, x.inicial, x.entradas, x.salidas, x.final, x.sin_movimiento]),
    [["A", 100, 50, 30, 120, false], ["B", 12, 0, 0, 12, true], ["C", 0, 0, 0, 0, true]]);
  assert.equal(f[0].lotes, "L1 (vence 12/2027): 120");
  assert.deepEqual(totales(f), { productos: 3, sin_movimiento: 2, inicial: 112, entradas: 50, salidas: 30, final: 132, formulas: 9 });
  assert.equal(observacion(f[1]), "Sin movimiento en el periodo");
  assert.equal(observacion(f[0]), "Devoluciones de pacientes 1 und (en entradas); bajas o destrucción 3 und (en salidas); 2 und vendidas sin fórmula registrada");
});

test("sin productos de control especial el informe sale vacío y lo advierte (se presenta en ceros)", () => {
  const f = consolidar([], {});
  assert.equal(f.length, 0);
  const a = revisarInforme(f, { mesAbierto: false, hayConfig: true });
  assert.ok(a.some((x) => /ceros/.test(x.texto)));
  assert.equal(detiene(a), false);
});

test("plantilla: base válida, campos desconocidos o repetidos rechazados, títulos por defecto", () => {
  assert.ok(PLANTILLA_BASE.every((c) => CAMPOS[c.campo]));
  assert.equal(validarPlantilla(PLANTILLA_BASE).ok, true);
  assert.equal(validarPlantilla([]).ok, false);
  assert.match(validarPlantilla([{ campo: "inventado", titulo: "X" }]).error, /desconocido/);
  assert.match(validarPlantilla([{ campo: "cum" }, { campo: "cum" }]).error, /repetido/);
  const v = validarPlantilla([{ campo: "cum", titulo: "  Código   CUM " }, { campo: "saldo_final" }]);
  assert.deepEqual(v.plantilla, [{ campo: "cum", titulo: "Código CUM" }, { campo: "saldo_final", titulo: "Saldo final" }]);
  assert.equal(validarPlantilla(Array.from({ length: 41 }, () => ({ campo: "cum" }))).ok, false);
});

test("aplicar plantilla: orden de columnas, mayúscula fija, ceros y N/A (art. 91)", () => {
  const f = consolidar([prod("A", { ficha: { ...ficha, cum: null } }), prod("B")], { A: { inicial: 5, salidas: 2, dispensado: 2, formulas: 1 } });
  const { columnas, datos } = aplicarPlantilla(f, [{ campo: "consecutivo", titulo: "N.º" }, { campo: "principio_activo", titulo: "Principio activo" }, { campo: "cum", titulo: "CUM" },
    { campo: "saldo_inicial", titulo: "Saldo anterior" }, { campo: "salidas", titulo: "Salidas" }, { campo: "saldo_final", titulo: "Saldo final" }, { campo: "departamento", titulo: "Depto" }], ctx);
  assert.deepEqual(columnas.map((c) => c[1]), ["N.º", "PRINCIPIO ACTIVO", "CUM", "SALDO ANTERIOR", "SALIDAS", "SALDO FINAL", "DEPTO"]);
  assert.deepEqual(datos[0], { consecutivo: 1, principio_activo: "ACETAMINOFÉN + CODEÍNA", cum: "N/A", saldo_inicial: 5, salidas: 2, saldo_final: 3, departamento: "TOLIMA" });
  assert.deepEqual(datos[1], { consecutivo: 2, principio_activo: "ACETAMINOFÉN + CODEÍNA", cum: "19912345-01", saldo_inicial: 0, salidas: 0, saldo_final: 0, departamento: "TOLIMA" });
  const normal = aplicarPlantilla(f, [{ campo: "medicamento", titulo: "Medicamento" }], ctx, false);
  assert.equal(normal.datos[0].medicamento, "Producto A");
});

test("revisión antes de exportar: mes abierto, ficha incompleta, sin fórmula y saldo negativo detienen", () => {
  const ok = consolidar([prod("A")], { A: { inicial: 5, entradas: 1 } });
  assert.deepEqual(revisarInforme(ok, { mesAbierto: false, hayConfig: true }), []);
  const malo = consolidar([prod("A", { ficha: null }), prod("B")], { B: { inicial: 1, salidas: 3, sin_formula: 3 } });
  const a = revisarInforme(malo, { mesAbierto: true, hayConfig: false });
  assert.ok(detiene(a));
  for (const r of [/mes aún no termina/, /negativo en Producto B/, /sin fórmula registrada: Producto B \(3 und\)/, /Ficha incompleta .*Producto A/, /departamento y el Fondo/])
    assert.ok(a.some((x) => r.test(x.texto)), String(r));
});
