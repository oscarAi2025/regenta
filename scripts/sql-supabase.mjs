// Genera los SQL para instalar Regenta en Supabase desde su editor SQL (sin contraseña ni terminal).
// Toma una base ya preparada con db-reset --produccion [--demo] contra la copia local de Supabase
// (tests/supabase-local.sql) y escribe en db/supabase/:
//   1_migraciones.sql  las migraciones 001–NNN y su registro en regenta_migraciones
//   2_datos_NN.sql     los datos (catálogo maestro, alertas INVIMA y la demo), en partes de ~1 MB
// Uso: DATABASE_URL='postgres://postgres@localhost:5433/regenta?host=/tmp' node scripts/sql-supabase.mjs
import pg from "pg";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
await db.connect();
const salida = new URL("../db/supabase/", import.meta.url);
rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });

// 1. Migraciones, en una sola transacción: si una falla, no queda nada a medias.
const archivos = readdirSync(new URL("../db/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
let m = "-- Regenta: migraciones. Pegar en Supabase → SQL Editor → Run. Se puede correr una sola vez.\nbegin;\n";
m += "create table regenta_migraciones (nombre text primary key, aplicada timestamptz not null default now());\nrevoke all on regenta_migraciones from public;\n";
for (const f of archivos) m += `\n-- ${f}\n${readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8")}\ninsert into regenta_migraciones (nombre) values ('${f}');\n`;
m += "commit;\n";
writeFileSync(new URL("1_migraciones.sql", salida), m);

// 2. Datos. Orden por llaves foráneas (padres primero); los triggers propios se apagan durante la carga para copiar
//    las filas tal cual (fechas de la demo, cadena de auditoría) y se vuelven a encender.
const { rows: tablas } = await db.query(`select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'regenta_migraciones' order by 1`);
const { rows: fks } = await db.query(`select c.conrelid::regclass::text hijo, c.confrelid::regclass::text padre from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and c.contype = 'f' and c.conrelid <> c.confrelid`);
const orden = [], visto = new Set();
const visitar = (t) => { if (visto.has(t)) return; visto.add(t); for (const f of fks) if (f.hijo === t) visitar(f.padre); orden.push(t); };
for (const { t } of tablas) visitar(t);

const partes = [];
let actual = "", n = 0;
const cerrar = () => { if (actual) partes.push(actual); actual = ""; };
for (const t of orden) {
  const { rows: cols } = await db.query(`select attname, attidentity from pg_attribute where attrelid = $1::regclass and attnum > 0
    and not attisdropped and attgenerated = '' order by attnum`, [t]);
  const lista = cols.map((c) => `"${c.attname}"`).join(", ");
  const identidad = cols.some((c) => c.attidentity === "a") ? " overriding system value" : "";
  const total = Number((await db.query(`select count(*) n from ${t}`)).rows[0].n);
  // En trozos de 2.000 filas. El JSON sale como texto de Postgres, sin pasar por JavaScript, para que los números
  // conserven su escala (81850.00 en un jsonb de auditoría no se vuelve 81850).
  for (let i = 0; i < total; i += 2000) {
    const json = (await db.query(`select json_agg(x)::text j from (select ${lista} from ${t} order by ctid limit 2000 offset ${i}) x`)).rows[0].j;
    if (json.includes("$rg$")) throw new Error("delimitador en los datos");
    const s = `insert into ${t} (${lista})${identidad} select ${lista} from jsonb_populate_recordset(null::${t}, $rg$${json}$rg$::jsonb);\n`;
    if (actual.length + s.length > 1_000_000) cerrar();
    actual += s; n += Math.min(2000, total - i);
  }
}
cerrar();
const { rows: seqs } = await db.query(`select s.relname seq, last_value from pg_sequences q join pg_class s on s.relname = q.sequencename
  where q.schemaname = 'public' and last_value is not null`);
const triggers = (accion) => orden.map((t) => `alter table ${t} ${accion} trigger user;`).join("\n");
partes.forEach((p, i) => {
  let s = `-- Regenta: datos, parte ${i + 1} de ${partes.length}. Correr después de 1_migraciones.sql y en orden.\nbegin;\n${triggers("disable")}\n${p}`;
  if (i === partes.length - 1) s += seqs.map((q) => `select setval('${q.seq}', ${q.last_value});`).join("\n") + "\n";
  s += `set constraints all immediate;\n${triggers("enable")}\ncommit;\n`;
  writeFileSync(new URL(`2_datos_${String(i + 1).padStart(2, "0")}.sql`, salida), s);
});
await db.end();
console.log(`migraciones: ${archivos.length} · datos: ${n} filas en ${partes.length} partes`);
