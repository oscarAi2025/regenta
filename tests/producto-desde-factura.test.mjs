// Producto nuevo desde una línea de la factura. node --experimental-strip-types --test tests/producto-desde-factura.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { unidadesEnDescripcion, preciosSugeridos, margenDe, nombreDeFactura, MARGEN_SUGERIDO } from "../src/lib/producto-desde-factura.ts";

test("Unidades por caja desde la descripción real de las facturas de AXA, Zanecol, Allers y Pasteur", () => {
  const casos = [
    ["DIPIRONA 1 GR/2 ML CAJA 10 AMPOLLA VITALIS", 10],
    ["DIMARD 200 MG CAJA 20 TABLETAS", 20],
    ["CLINBAC CAPSULAS 300 MG CAJA 24 UNIDADES LABQUIFAR", 24],
    ["METRONIDAZOL 500 MG CAJA 100 TABLETAS COASPHARMA", 100],
    ["FLUCONAZOL 200 MG CAJA 4 CAP NOVAMED", 4],
    ["LOSARTAN 50 MG CJA X 30 TAB EXPOFARMA", 30],
    ["IMPOMEL- X 15 MG CJA X 10 TAB", 10],
    ["IBUPROFENO 800 MG CJA X 50 TAB GENFAR", 50],
    ["NAZIL GOTAS X 15 ML", 1],
    ["HOJAS BISTURI # 12 CJA X 100 UND - PARAMOUNT", 100],
    ["SULFADIAZINA DE PLATA POTE 30 GR MEMPHIS", 1],
    ["ALCOHOL 70% GALON x 3800 ml JGB", 1],
    ["ACICLOVIR 800 MG CAJA X 10 UNDS ROPSOHN", 10],
    ["LIMPIADERM CREMA TOPICA X 20 GR BIOQUIFAR", 1],
    ["GASA NO TEJIDA 7.5 X 7.5 X 2 UNDS ESTERIL", 2],
    ["DEXAMETASONA 8 mg / 2 mL SOL INY AMP- BIOSANO", 1],
    ["CURITAS TUBO 2 X 10UNDS", 10],
    ["LORATADINA 10 MG X 10TAB", 10],
  ];
  for (const [d, n] of casos) assert.equal(unidadesEnDescripcion(d), n, d);
});

test("Precio sugerido: margen sobre la venta sin IVA, redondeado a $100 la caja y a $50 la suelta, nunca la suelta más cara que la caja", () => {
  // Costo $10.000 la caja sin IVA, 25 %: 10.000 / 0,75 = 13.333,33 → $13.400.
  assert.deepEqual(preciosSugeridos({ costo: 10000, descuentoPct: 0, como: "caja", upc: 1, ivaPct: 0 }), { precio_caja: 13400, precio_unidad: null });
  // Con IVA 19 %: 13.333,33 × 1,19 = 15.866,67 → $15.900.
  assert.equal(preciosSugeridos({ costo: 10000, descuentoPct: 0, como: "caja", upc: 1, ivaPct: 19 }).precio_caja, 15900);
  // Pasteur (Aciclovir): lista $9.370 con 6 % → neto 8.807,80 la caja de 10 → caja $11.800; suelta 11.800 / 10 × 1,1 = 1.298 → $1.300.
  assert.deepEqual(preciosSugeridos({ costo: 9370, descuentoPct: 6, como: "caja", upc: 10, ivaPct: 0 }), { precio_caja: 11800, precio_unidad: 1300 });
  // Factura por unidades sueltas: el costo de la caja es costo × unidades.
  assert.equal(preciosSugeridos({ costo: 1000, descuentoPct: 0, como: "unidad", upc: 10, ivaPct: 0 }).precio_caja, 13400);
  // Caja de 2: la suelta no supera la caja.
  const dos = preciosSugeridos({ costo: 100, descuentoPct: 0, como: "caja", upc: 2, ivaPct: 0 });
  assert.ok(dos.precio_unidad <= dos.precio_caja);
  // Sin costo (bonificada o la bodega): sin sugerencia.
  assert.deepEqual(preciosSugeridos({ costo: null, descuentoPct: 0, como: "caja", upc: 10, ivaPct: 0 }), { precio_caja: null, precio_unidad: null });
  assert.equal(preciosSugeridos({ costo: 10000, descuentoPct: 0, como: "caja", upc: 1, ivaPct: 0, margen: 40 }).precio_caja, 16700);
});

test("Margen que ve la persona y nombre del catálogo", () => {
  assert.equal(margenDe(13400, 10000, 0), 25.4);
  assert.equal(margenDe(15900, 10000, 19), 25.2);
  assert.equal(margenDe(9000, 10000, 0), -11.1);
  assert.equal(MARGEN_SUGERIDO, 25);
  assert.equal(nombreDeFactura("  IMPOMEL- X 15 MG  CJA X 10 TAB - "), "IMPOMEL- X 15 MG CJA X 10 TAB");
  // La bonificada no crea otro producto «… BONIFICADO»: es el mismo producto.
  assert.equal(nombreDeFactura("ACETAMINOFEN 500 MG X 100 TAB (BONIFICADO)"), "ACETAMINOFEN 500 MG X 100 TAB");
});
