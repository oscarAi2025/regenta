import { test } from "node:test";
import assert from "node:assert/strict";
import { pesosEnLetras as l } from "../src/lib/letras.ts";

test("valor en letras de la factura (pesos colombianos)", () => {
  const casos = [[0, "Cero pesos m/cte"], [1, "Un peso m/cte"], [21, "Veintiún pesos m/cte"], [100, "Cien pesos m/cte"], [101, "Ciento un pesos m/cte"],
    [1000, "Mil pesos m/cte"], [1500, "Mil quinientos pesos m/cte"], [13150, "Trece mil ciento cincuenta pesos m/cte"], [21000, "Veintiún mil pesos m/cte"],
    [100000, "Cien mil pesos m/cte"], [190365, "Ciento noventa mil trescientos sesenta y cinco pesos m/cte"], [1000000, "Un millón de pesos m/cte"],
    [2000000, "Dos millones de pesos m/cte"], [3993462, "Tres millones novecientos noventa y tres mil cuatrocientos sesenta y dos pesos m/cte"],
    [51881934, "Cincuenta y un millones ochocientos ochenta y un mil novecientos treinta y cuatro pesos m/cte"], [1000000000, "Mil millones de pesos m/cte"],
    [999999, "Novecientos noventa y nueve mil novecientos noventa y nueve pesos m/cte"], [13150.6, "Trece mil ciento cincuenta y un pesos m/cte"]];
  for (const [n, e] of casos) assert.equal(l(n), e, String(n));
});
