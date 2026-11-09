// Factura del proveedor → compra (lógica pura). node --experimental-strip-types --test tests/factura-proveedor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { aplicarLotes, esCargo, pdfDelZip, numeroLocal, precioDeLinea, abrirZip, leerArchivoXml, leerDocumento, leerXml, loteEnDescripcion, fechaIso, fichas, parecido } from "../src/lib/factura-proveedor.ts";

const fx = (n) => readFileSync(new URL(`./fixtures/facturas/${n}`, import.meta.url));

/** ZIP mínimo (un archivo, deflate o guardado) para probar el lector sin depender de otra librería. */
function zip(nombre, contenido, deflate = true) {
  const datos = Buffer.from(contenido), comp = deflate ? deflateRawSync(datos) : datos, n = Buffer.from(nombre);
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(deflate ? 8 : 0, 8); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(deflate ? 8 : 0, 10); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 42);
  const cuerpo = Buffer.concat([loc, n, comp]);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10); fin.writeUInt32LE(46 + n.length, 12); fin.writeUInt32LE(cuerpo.length, 16);
  return new Uint8Array(Buffer.concat([cuerpo, cen, n, fin]));
}

test("ZIP real de un proveedor (Distribuidora Pasteur): es una NOTA CRÉDITO y se reconoce como tal", () => {
  const [d] = leerArchivoXml("ad0890.zip", fx("pasteur-nota-credito.zip"));
  assert.equal(d.tipo, "nota_credito");
  assert.equal(d.numero, "90290190");
  assert.equal(d.fecha, "2026-11-06");
  assert.equal(d.proveedor.nombre, "DISTRIBUIDORA PASTEUR S.A.");
  assert.equal(d.proveedor.nit, "890941663");
  assert.equal(d.proveedor.dv, "1");
  assert.equal(d.comprador.nit, "901845370");
  assert.equal(d.referencia, "400875880");
  assert.equal(d.cufe?.length, 96);
  assert.equal(d.lineas.length, 1);
  assert.equal(d.totales.total, 101634);
});

test("Factura UBL en su contenedor de la DIAN: cabecera, proveedor, CUFE y totales", () => {
  const d = leerDocumento(fx("factura-prueba.xml").toString("utf8"));
  assert.equal(d.tipo, "factura");
  assert.equal(d.numero, "FEP4521");
  assert.equal(d.fecha, "2026-11-05");
  assert.equal(d.vence_pago, "2026-12-05");
  assert.match(d.cufe, /^a1b2c3/);
  assert.deepEqual(d.proveedor, { nombre: "DROGUERIA MAYORISTA DE PRUEBA S.A.S.", nit: "900123456", dv: "7" });
  assert.equal(d.comprador.nit, "900000001");
  assert.deepEqual(d.totales, { base: 206000, iva: 1520, descuentos: 0, total: 207520 });
});

test("Líneas: precio, descuento, IVA, lote y vencimiento (en la descripción o en campos UBL), código de barras y bonificadas", () => {
  const [a, b, c] = leerDocumento(fx("factura-prueba.xml").toString("utf8")).lineas;
  assert.deepEqual([a.cantidad, a.precio, a.descuento_pct, a.iva_pct, a.base], [10, 22000, 10, 0, 198000]);
  assert.deepEqual([a.lote, a.vence, a.codigo, a.ean], ["26312018", "2029-04-18", "MP-0042", null]);
  assert.equal(a.nombre, "ACETAMINOFEN 500 MG X 100 TABLETAS");
  assert.equal(a.bonificada, false);
  assert.deepEqual([b.ean, b.lote, b.vence, b.iva_pct], ["7702057000016", "L-77A", "2028-03-31", 19]);
  assert.equal(b.descripcion, "Crema antipañalitis & óxido de zinc 60 g");
  assert.deepEqual([c.bonificada, c.lote, c.vence, c.cantidad], [true, "26312018", "2029-04-18", 1]);
});

test("Lote y vencimiento escritos dentro de la descripción (como en la foto de la factura de ejemplo)", () => {
  assert.deepEqual(loteEnDescripcion("acetaminofen delta (FECHA VENCIMIENTO: 18/04/2029)(LOTE: 26312018)"), { lote: "26312018", vence: "2029-04-18", nombre: "acetaminofen delta" });
  assert.deepEqual(loteEnDescripcion("AZITROMICINA (DELTAZITROM ) (FECHA VENCIMIENTO:30/12/2028)(LOTE:425251292)"), { lote: "425251292", vence: "2028-12-30", nombre: "AZITROMICINA (DELTAZITROM )" });
  assert.deepEqual(loteEnDescripcion("AMETREX ACETAMINOFEN 120 ML (FECHA VENCIMIENTO:28/05/2028)(LOTE:000926)"), { lote: "000926", vence: "2028-05-28", nombre: "AMETREX ACETAMINOFEN 120 ML" });
  assert.deepEqual(loteEnDescripcion("LIMPIADERM CREMA TOPICA X 20 GR BIOQUIFAR (FECHA VENCIMIENTO: 31/07/2028)(LOTE:L2226)").lote, "L2226");
  assert.deepEqual(loteEnDescripcion("Ibuprofeno 400mg Lote: AB-1234 Vence 2027-01-31"), { lote: "AB-1234", vence: "2027-01-31", nombre: "Ibuprofeno 400mg" });
  assert.deepEqual(loteEnDescripcion("Suero oral 1 LT sabor fresa"), { lote: null, vence: null, nombre: "Suero oral 1 LT sabor fresa" });
  assert.equal(loteEnDescripcion("Loratadina VENCE 31/02/2028").vence, null, "31 de febrero no existe");
  assert.equal(fechaIso("05", "11", "26"), "2026-11-05");
});

test("ZIP: deflate y guardado; un ZIP sin XML da un mensaje claro", () => {
  const xml = fx("factura-prueba.xml").toString("utf8");
  for (const def of [true, false]) {
    const [f] = abrirZip(zip("f.xml", xml, def));
    assert.equal(f.nombre, "f.xml"); assert.equal(Buffer.from(f.datos).toString("utf8"), xml);
    assert.equal(leerArchivoXml("f.zip", zip("f.xml", xml, def))[0].numero, "FEP4521");
  }
  assert.throws(() => leerArchivoXml("f.zip", zip("factura.pdf", "%PDF-1.4")), /no trae el XML/);
  assert.throws(() => abrirZip(new Uint8Array([1, 2, 3])), /no es un ZIP/);
});

test("XML que no es factura electrónica, o roto: error legible (sin entidades externas)", () => {
  assert.throws(() => leerDocumento("<Otro><a>1</a></Otro>"), /no es una factura electrónica/);
  assert.throws(() => leerDocumento(""), /no es un XML/);
  const x = leerXml(`<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a b='1 &amp; 2'>&x;&lt;ok&gt;<![CDATA[<c>]]></a>`).c[0];
  assert.equal(x.a.b, "1 & 2");
  assert.equal(x.t, "&x;<ok><c>");
});

test("Emparejar por nombre: el producto correcto puntúa alto; otra concentración o presentación, bajo", () => {
  const desc = "ACETAMINOFEN 500 MG X 100 TABLETAS";
  const bien = parecido(desc, { nombre: "Acetaminofén 500 mg caja x 100 tabletas", laboratorio: "MK" });
  const otraDosis = parecido(desc, { nombre: "Acetaminofén 1 g caja x 10 tabletas", laboratorio: "MK" });
  const otro = parecido(desc, { nombre: "Ibuprofeno 400 mg x 10", laboratorio: "MK" });
  assert.ok(bien >= 0.75, `bien ${bien}`);
  assert.ok(bien - otraDosis >= 0.15, `otra dosis ${otraDosis}`);
  assert.ok(otro < 0.3, `otro ${otro}`);
  assert.equal(parecido(desc, { nombre: "Metronidazol tabletas 500 mg caja x 100", laboratorio: "Ecar" }), 0, "solo coinciden las cifras");
  assert.deepEqual(fichas("Crema 60 G X 3 Und"), ["crema", "60g", "x3"]);
  assert.deepEqual(fichas("ACETAMINOFEN 150MG/5ML JBE"), ["acetaminofen", "150mg", "5ml", "jarabe"]);
  assert.ok(parecido("ACETAMINOFEN 500 MG TAB X 100", { nombre: "Acetaminofén 500 mg x 100 tabletas", laboratorio: null }) >= 0.75);
  assert.ok(parecido("ACETAMINOFEN JARABE 120 ML", { nombre: "Acetaminofén 500 mg x 100 tabletas", laboratorio: null }) < 0.6);
});

test("Factura real de Distribuidora Pasteur (ZIP): 18 líneas con precio de lista, descuento y lote que cuadran con su PDF", () => {
  const [d] = leerArchivoXml("fv.zip", fx("pasteur-factura.zip"));
  assert.equal(d.tipo, "factura"); assert.equal(d.numero, "400876456"); assert.equal(d.fecha, "2026-11-05");
  assert.equal(d.proveedor.nit, "890941663"); assert.equal(d.lineas.length, 18);
  assert.deepEqual(d.totales, { base: 1549065, iva: 10250.91, descuentos: null, total: 1559315.91 });
  const [a, , , , , , alka, redoxon] = d.lineas;
  assert.deepEqual([a.codigo, a.cantidad, a.precio, a.descuento_pct, a.lote, a.iva_pct], ["004011", 5, 9370, 6, "91985", 0]);
  assert.deepEqual([alka.precio, alka.descuento_pct, alka.lote], [69832, 15, "X268K0"]);
  assert.deepEqual([redoxon.precio, redoxon.descuento_pct, redoxon.lote, redoxon.iva_pct], [31007, 13, "ARLUW5", 19]);
  for (const l of d.lineas) assert.ok(Math.abs(l.precio * l.cantidad * (1 - l.descuento_pct / 100) - l.base) < 1, `línea ${l.n} cuadra`);
  assert.ok(d.lineas.every((l) => l.lote && l.vence === null), "Pasteur manda lote pero no vencimiento");
});

test("Números con formato colombiano o inglés y precio que cuadra con la línea", () => {
  assert.deepEqual(["9.370,00", "8,808.00", "6,00", "44039", "1.000", "$ 12.500", "UND", "91985A"].map(numeroLocal), [9370, 8808, 6, 44039, 1000, 12500, null, null]);
  // Emisor que repite la cantidad en BaseQuantity con el precio unitario neto.
  assert.deepEqual(precioDeLinea({ cantidad: 5, base: 44040, precioXml: 8808, bq: 5, desc: 0, conDescuento: false, props: [] }), { precio: 8808, descuento: 0 });
  // Emisor con precio por la cantidad base.
  assert.deepEqual(precioDeLinea({ cantidad: 4, base: 2000, precioXml: 1000, bq: 2, desc: 0, conDescuento: false, props: [] }), { precio: 500, descuento: 0 });
  // Nada cuadra: valor de la línea entre la cantidad.
  assert.deepEqual(precioDeLinea({ cantidad: 3, base: 3000, precioXml: 7, bq: 1, desc: 0, conDescuento: false, props: [] }), { precio: 1000, descuento: 0 });
});

// ── Facturas reales de tres proveedores más (09/11/2026): cada uno manda el lote distinto.
const AXA_PDF = [ // lo que trae el PDF de AXA (la IA lo lee del PDF del ZIP); en otro orden a propósito
  ["7702195076510", "690D03", "2029-03-01"], ["7707236128814", "A260682", "2028-06-14"], ["7707355053776", "02990225", "2027-02-01"], ["7702057070731", "6E1919A", "2027-11-29"],
  ["7703712031784", "G18976", "2029-06-01"], ["7707019413816", "404926", "2028-07-01"], ["7703712035799", "G18395", "2027-08-01"], ["7702132008444", "1613425", "2028-06-01"],
  ["7702057700836", "6J2488A", "2028-07-29"], ["7702057071073", "6E6696A", "2027-11-15"], ["7704412186057", "39826", "2028-09-01"], ["7705137110013", "0595", "2028-09-01"],
  ["7707232095868", "1990326", "2028-03-01"], ["7703712035492", "G11056", "2028-09-01"], ["7702896933754", "A191G26", "2028-02-01"], ["7702605337606", "G00729A", "2029-04-01"],
  ["7702184030158", "G070207", "2028-07-01"], ["7709482273362", "K260056", "2029-08-14"], ["7707236126858", "N260455", "2029-05-19"], ["7702896001774", "E111G26", "2029-07-01"],
  ["7709193551063", "A260712", "2029-06-24"], ["7501303495447", "XB30X8E", "2030-06-01"], ["7703546927468", "2608001299", "2029-08-01"], ["7702605101146", "G00981A", "2028-05-01"],
];

test("Distribuciones AXA (ZIP64): 25 líneas que cuadran, ninguna bonificada por error; lotes del PDF casados por código", () => {
  const [d] = leerArchivoXml("z.zip", fx("axa-factura.zip"));
  assert.equal(d.numero, "AXBF929200"); assert.equal(d.proveedor.nit, "800052534"); assert.equal(d.lineas.length, 25);
  assert.deepEqual(d.totales, { base: 2441357.96, iva: 11646.76, descuentos: null, total: 2453004.72 });
  assert.ok(d.lineas.every((l) => !l.bonificada), "el precio de referencia que AXA pone en todas las líneas no las vuelve bonificadas");
  for (const l of d.lineas) assert.ok(Math.abs(l.precio * l.cantidad * (1 - l.descuento_pct / 100) - l.base) < 1, `línea ${l.n} cuadra`);
  assert.deepEqual([d.lineas[14].descuento_pct, d.lineas[19].descuento_pct, d.lineas[10].iva_pct], [8, 15, 19]);
  assert.ok(d.lineas.every((l) => !l.lote), "el XML de AXA no trae lotes");
  assert.ok(pdfDelZip("z.zip", fx("axa-factura.zip"))?.length > 30000, "el PDF viene en el ZIP");
  const con = aplicarLotes(d.lineas, AXA_PDF.map(([c, lote, vence]) => ({ descripcion: "x", codigo: c, lote, vence, cantidad: null })));
  assert.equal(con.length, 25);
  assert.deepEqual([con[0].lote, con[0].vence, con[24].lote, con[24].vence], ["A260682", "2028-06-14", "690D03", "2029-03-01"]);
  assert.equal(con.filter((l) => l.lote).length, 24, "24 con lote; el jabón no trae lote ni en el PDF");
  assert.equal(con[10].lote, null);
  assert.ok(con.every((l, k) => l.cantidad === d.lineas[k].cantidad && l.precio === d.lineas[k].precio), "cantidades y precios siguen siendo los del XML");
});

test("Zanecol: 4 líneas; el PDF trae los lotes en otro orden y sin códigos: se casan por nombre", () => {
  const [d] = leerArchivoXml("z.zip", fx("zanecol-factura.zip"));
  assert.equal(d.numero, "FVZ7037"); assert.equal(d.totales.total, 1228650);
  assert.deepEqual(d.lineas.map((l) => [l.codigo, l.cantidad, l.precio]), [["SOPH001", 50, 10980], ["EXPO002", 50, 2890], ["GNFR002", 50, 7590], ["IMPO001", 50, 3113]]);
  const pdf = [ // orden del PDF (alfabético), como lo leería la IA
    { descripcion: "IBUPROFENO 800 MG CJA X 50 TAB GENFAR", codigo: null, lote: "G01497D", vence: "2028-09-30", cantidad: 50 },
    { descripcion: "IMPOMEL- X 15 MG CJA X 10 TAB", codigo: null, lote: "IM-162-26", vence: "2028-08-30", cantidad: 50 },
    { descripcion: "LOSARTAN 50 MG CJA X 30 TAB EXPOFARMA", codigo: null, lote: "2600294", vence: "2029-06-01", cantidad: 50 },
    { descripcion: "NAZIL GOTAS X 15 ML", codigo: null, lote: "4034118", vence: "2028-06-08", cantidad: 50 },
  ];
  const con = aplicarLotes(d.lineas, pdf);
  assert.deepEqual(con.map((l) => [l.codigo, l.lote, l.vence]), [["SOPH001", "4034118", "2028-06-08"], ["EXPO002", "2600294", "2029-06-01"], ["GNFR002", "G01497D", "2028-09-30"], ["IMPO001", "IM-162-26", "2028-08-30"]]);
});

test("Allers: lote y vencimiento en el XML («VencimientoLote»), una línea con dos lotes se parte, el flete es un cargo", () => {
  const [d] = leerArchivoXml("z.zip", fx("allers-factura.zip"));
  assert.equal(d.numero, "FEC918739"); assert.deepEqual([d.totales.base, d.totales.iva, d.totales.total], [551010, 12709, 563719]);
  assert.equal(d.lineas.length, 16, "15 productos + 1 partido en 2 lotes = 16 líneas (con el flete)");
  assert.deepEqual([d.lineas[0].lote, d.lineas[0].vence, d.lineas[0].cantidad], ["26016847", "2029-01-31", 70]);
  assert.deepEqual(d.lineas.filter((l) => l.codigo === "17913").map((l) => [l.cantidad, l.base, l.lote, l.vence]), [[3, 2889, "25126782", "2028-12-31"], [11, 10593, "26016807", "2029-01-31"]]);
  const flete = d.lineas.find((l) => /FLETE/.test(l.descripcion));
  assert.deepEqual([flete.cargo, flete.lote, flete.iva_pct], [true, null, 19]);
  assert.ok(d.lineas.filter((l) => !l.cargo).every((l) => l.lote && l.vence), "todos los productos con lote y vencimiento");
  assert.equal(Math.round(d.lineas.reduce((a, l) => a + l.base, 0)), 551010, "la suma sigue cuadrando tras partir la línea");
  assert.deepEqual(["FLETE CLIENTE NACIONAL", "Domicilio", "Transporte urgente", "Seguro de mercancía", "Flexamina"].map(esCargo), [true, true, true, true, false]);
});

test("ZIP «bomba»: varias entradas que apuntan al mismo bloque comprimido no se inflan en memoria", async () => {
  const { deflateRawSync } = await import("node:zlib");
  const plano = Buffer.alloc(14 * 1024 * 1024, 0x61); plano.write("<Invoice>", 0);
  const comp = deflateRawSync(plano, { level: 9 });
  const nombre = Buffer.from("f.xml");
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(plano.length, 22); local.writeUInt16LE(nombre.length, 26);
  const cuerpo = Buffer.concat([local, nombre, comp]);
  const cds = [];
  for (let k = 0; k < 40; k++) { const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(plano.length, 24); cd.writeUInt16LE(nombre.length, 28); cd.writeUInt32LE(0, 42); cds.push(cd, nombre); }
  const dir = Buffer.concat(cds);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(40, 8); fin.writeUInt16LE(40, 10); fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(cuerpo.length, 16);
  const zip = new Uint8Array(Buffer.concat([cuerpo, dir, fin]));
  assert.ok(zip.length < 40_000);
  const antes = process.memoryUsage().rss;
  assert.throws(() => leerArchivoXml("bomba.zip", zip), /demasiado grande|dañado/);
  assert.ok(process.memoryUsage().rss - antes < 200 * 1024 * 1024, "no debe inflar cientos de MB");
});
