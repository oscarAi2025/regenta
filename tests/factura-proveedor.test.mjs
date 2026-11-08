// Factura del proveedor → compra (lógica pura). node --experimental-strip-types --test tests/factura-proveedor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { abrirZip, leerArchivoXml, leerDocumento, leerXml, loteEnDescripcion, fechaIso, fichas, parecido } from "../src/lib/factura-proveedor.ts";

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
  assert.deepEqual(fichas("Crema 60 G X 3 Und"), ["crema", "60g", "x3"]);
  assert.deepEqual(fichas("ACETAMINOFEN 150MG/5ML JBE"), ["acetaminofen", "150mg", "5ml", "jarabe"]);
  assert.ok(parecido("ACETAMINOFEN 500 MG TAB X 100", { nombre: "Acetaminofén 500 mg x 100 tabletas", laboratorio: null }) >= 0.75);
  assert.ok(parecido("ACETAMINOFEN JARABE 120 ML", { nombre: "Acetaminofén 500 mg x 100 tabletas", laboratorio: null }) < 0.6);
});
