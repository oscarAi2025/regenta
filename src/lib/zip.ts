import "server-only";
import { deflateRawSync } from "node:zlib";

// ZIP mínimo (deflate) para descargas de varios archivos, sin dependencias. Formato PKWARE APPNOTE 6.3: cabecera local
// por archivo, directorio central y fin de directorio. Nombres en UTF-8 (bit 11).
const TABLA = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = TABLA[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function zip(archivos: { nombre: string; datos: string | Buffer }[]): Buffer {
  const ahora = new Date();
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const fecha = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
  const locales: Buffer[] = [], central: Buffer[] = [];
  let desplazamiento = 0;
  for (const a of archivos) {
    const datos = Buffer.isBuffer(a.datos) ? a.datos : Buffer.from(a.datos, "utf8");
    const comprimido = deflateRawSync(datos), nombre = Buffer.from(a.nombre, "utf8"), crc = crc32(datos);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(8, 8);
    l.writeUInt16LE(hora, 10); l.writeUInt16LE(fecha, 12); l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(comprimido.length, 18); l.writeUInt32LE(datos.length, 22); l.writeUInt16LE(nombre.length, 26); l.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(hora, 12); c.writeUInt16LE(fecha, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comprimido.length, 20);
    c.writeUInt32LE(datos.length, 24); c.writeUInt16LE(nombre.length, 28); c.writeUInt32LE(desplazamiento, 42);
    locales.push(l, nombre, comprimido); central.push(c, nombre);
    desplazamiento += 30 + nombre.length + comprimido.length;
  }
  const dir = Buffer.concat(central), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, dir, fin]);
}
