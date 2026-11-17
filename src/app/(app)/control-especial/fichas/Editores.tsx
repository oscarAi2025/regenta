"use client";
import { useState } from "react";

type Ficha = { principio_activo: string | null; concentracion: string | null; forma_farmaceutica: string | null; cum: string | null; categoria: string | null };
type Producto = { id: string; nombre: string; laboratorio: string | null; unidades_por_caja: number; control_especial: boolean; ficha: Ficha | null };
type Columna = { campo: string; titulo: string };
type Config = {
  departamento: string | null; fondo: string | null; canal: string | null; destino: string | null;
  responsable: string | null; responsable_registro: string | null; plantilla: Columna[]; propia: boolean;
};

const DEPARTAMENTOS = ["Amazonas", "Antioquia", "Arauca", "Atlántico", "Bogotá D.C.", "Bolívar", "Boyacá", "Caldas", "Caquetá", "Casanare", "Cauca",
  "Cesar", "Chocó", "Córdoba", "Cundinamarca", "Guainía", "Guaviare", "Huila", "La Guajira", "Magdalena", "Meta", "Nariño", "Norte de Santander",
  "Putumayo", "Quindío", "Risaralda", "San Andrés y Providencia", "Santander", "Sucre", "Tolima", "Valle del Cauca", "Vaupés", "Vichada"];
const CANALES: [string, string][] = [["", "Sin definir"], ["correo", "Correo electrónico"], ["plataforma", "Plataforma web del fondo"], ["presencial", "Radicado en físico"], ["otro", "Otro"]];

async function enviar(url: string, cuerpo: unknown): Promise<{ ok?: string; error?: string }> {
  const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
  if (!r) return { error: "Sin conexión: revisa internet e intenta de nuevo." };
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: "Guardado." } : { error: j.error ?? "No se pudo guardar" };
}
const completa = (f: Ficha | null) => !!(f?.principio_activo && f.concentracion && f.forma_farmaceutica && f.cum);

/** Ficha de cada medicamento de control especial: lo que el informe necesita y la caja no pide. */
export function Fichas({ productos, categorias, demo }: { productos: Producto[]; categorias: string[]; demo: boolean }) {
  const faltan = productos.filter((p) => !completa(p.ficha)).length;
  return (
    <section className="tarjeta p-5 grid gap-4" aria-labelledby="fichas-titulo">
      <div>
        <h2 id="fichas-titulo" className="titulo text-xl">Fichas de los medicamentos</h2>
        <p className="text-sm text-muted mt-0.5">Principio activo (DCI), concentración, forma farmacéutica, CUM y listado de la Res. 315 de 2020.
          {productos.length > 0 && (faltan ? ` Faltan ${faltan} por completar.` : " Todas completas.")}</p>
      </div>
      {productos.length === 0
        ? <p className="text-muted">Aún no tienes medicamentos de control especial. Márcalos en <a href="/productos" className="underline font-semibold text-ink">Productos</a> → Editar → «Medicamento de control especial».</p>
        : <ul className="grid gap-3">{productos.map((p) => <FichaProducto key={p.id} p={p} categorias={categorias} demo={demo} />)}</ul>}
    </section>
  );
}

function FichaProducto({ p, categorias, demo }: { p: Producto; categorias: string[]; demo: boolean }) {
  const [f, setF] = useState({
    principio_activo: p.ficha?.principio_activo ?? "", concentracion: p.ficha?.concentracion ?? "", forma_farmaceutica: p.ficha?.forma_farmaceutica ?? "",
    cum: p.ficha?.cum ?? "", categoria: p.ficha?.categoria ?? categorias[0],
  });
  const [estado, setEstado] = useState<{ ok?: string; error?: string }>({});
  const [enviando, setEnviando] = useState(false);
  const lista = completa({ ...f });
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setEstado({});
    setEstado(await enviar("/api/control-especial/fichas", { producto_id: p.id, ...f }));
    setEnviando(false);
  }
  const id = (k: string) => `${k}-${p.id}`;
  return (
    <li className="rounded-xl border border-line p-4">
      <form onSubmit={guardar} className="grid gap-3" aria-label={`Ficha de ${p.nombre}`}>
        <div className="flex flex-wrap justify-between gap-2">
          <p className="font-semibold leading-snug min-w-0 [overflow-wrap:anywhere]">{p.nombre}{p.laboratorio ? <span className="font-normal text-muted"> · {p.laboratorio}</span> : null}{!p.control_especial && <span className="font-normal text-muted"> (ya no marcado)</span>}</p>
          <span className={`pastilla text-[12px] font-semibold ${lista ? "bg-cruz-soft text-cruz" : "bg-aviso-soft text-aviso"}`}>{lista ? "Completa" : "Incompleta"}</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-3">
          <label htmlFor={id("pa")} className="grid text-sm text-muted">Principio activo (DCI)
            <input id={id("pa")} maxLength={160} value={f.principio_activo} onChange={(e) => setF({ ...f, principio_activo: e.target.value })} className="campo" placeholder="Acetaminofén + codeína" />
          </label>
          <label htmlFor={id("co")} className="grid text-sm text-muted">Concentración
            <input id={id("co")} maxLength={80} value={f.concentracion} onChange={(e) => setF({ ...f, concentracion: e.target.value })} className="campo" placeholder="325 mg + 30 mg" />
          </label>
          <label htmlFor={id("ff")} className="grid text-sm text-muted">Forma farmacéutica
            <input id={id("ff")} maxLength={80} value={f.forma_farmaceutica} onChange={(e) => setF({ ...f, forma_farmaceutica: e.target.value })} className="campo" placeholder="Tableta" />
          </label>
          <label htmlFor={id("cum")} className="grid text-sm text-muted">CUM
            <input id={id("cum")} maxLength={20} inputMode="numeric" value={f.cum} onChange={(e) => setF({ ...f, cum: e.target.value })} className="campo num" placeholder="19912345-01" />
          </label>
        </div>
        <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
          <label htmlFor={id("cat")} className="grid text-sm text-muted">Listado (Res. 315 de 2020)
            <select id={id("cat")} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} className="campo">{categorias.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={enviando || demo} className="btn-oscuro">{enviando ? "Guardando…" : "Guardar ficha"}</button>
            {estado.ok && <p role="status" className="text-sm font-semibold text-cruz">{estado.ok}</p>}
            {estado.error && <p role="alert" className="text-sm text-alerta">{estado.error}</p>}
          </div>
        </div>
      </form>
    </li>
  );
}

/** Departamento y Fondo Rotatorio, canal de envío, responsable y plantilla de columnas del informe. */
export function Configuracion({ config, base, campos, demo }: { config: Config; base: Columna[]; campos: Columna[]; demo: boolean }) {
  const [d, setD] = useState({
    departamento: config.departamento ?? "", fondo: config.fondo ?? "", canal: config.canal ?? "", destino: config.destino ?? "",
    responsable: config.responsable ?? "", responsable_registro: config.responsable_registro ?? "",
  });
  const [cols, setCols] = useState<Columna[]>(config.plantilla);
  const [propia, setPropia] = useState(config.propia);
  const [nuevo, setNuevo] = useState("");
  const [estado, setEstado] = useState<{ ok?: string; error?: string }>({});
  const [enviando, setEnviando] = useState(false);
  const libres = campos.filter((c) => !cols.some((x) => x.campo === c.campo));
  const mover = (i: number, j: number) => { if (j < 0 || j >= cols.length) return; const n = [...cols]; [n[i], n[j]] = [n[j], n[i]]; setCols(n); setPropia(true); };
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setEstado({});
    setEstado(await enviar("/api/control-especial/configuracion", { ...d, plantilla: propia ? cols : null }));
    setEnviando(false);
  }
  return (
    <form onSubmit={guardar} className="tarjeta p-5 grid gap-5" aria-labelledby="config-titulo">
      <div>
        <h2 id="config-titulo" className="titulo text-xl">Fondo Rotatorio y formato del informe</h2>
        <p className="text-sm text-muted mt-0.5">Cada Fondo Rotatorio de Estupefacientes departamental define su formato y su canal. Pídele el formato vigente y deja aquí las columnas en el mismo orden: el Excel sale igual.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="grid text-sm text-muted">Departamento
          <select value={d.departamento} onChange={(e) => setD({ ...d, departamento: e.target.value, fondo: d.fondo || (e.target.value ? `Fondo Rotatorio de Estupefacientes de ${e.target.value}` : "") })} className="campo">
            <option value="">Elige…</option>{DEPARTAMENTOS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="grid text-sm text-muted lg:col-span-2">Fondo Rotatorio
          <input maxLength={160} value={d.fondo} onChange={(e) => setD({ ...d, fondo: e.target.value })} className="campo" placeholder="Fondo Rotatorio de Estupefacientes del Tolima" />
        </label>
        <label className="grid text-sm text-muted">Cómo se envía
          <select value={d.canal} onChange={(e) => setD({ ...d, canal: e.target.value })} className="campo">{CANALES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
        <label className="grid text-sm text-muted lg:col-span-2">Correo o enlace de envío
          <input maxLength={200} value={d.destino} onChange={(e) => setD({ ...d, destino: e.target.value })} className="campo" placeholder="El que indique tu Fondo Rotatorio" />
        </label>
        <label className="grid text-sm text-muted">Director técnico o responsable
          <input maxLength={120} value={d.responsable} onChange={(e) => setD({ ...d, responsable: e.target.value })} className="campo" />
        </label>
        <label className="grid text-sm text-muted">Registro o tarjeta profesional
          <input maxLength={40} value={d.responsable_registro} onChange={(e) => setD({ ...d, responsable_registro: e.target.value })} className="campo" />
        </label>
      </div>

      <div id="plantilla" className="grid gap-3">
        <div className="flex flex-wrap justify-between items-baseline gap-2">
          <h3 className="font-semibold">Columnas del informe {propia ? "(tu plantilla)" : "(plantilla base de Regenta)"}</h3>
          {propia && <button type="button" onClick={() => { setCols(base); setPropia(false); }} className="text-sm font-semibold text-cruz underline underline-offset-4">Volver a la plantilla base</button>}
        </div>
        <p className="text-sm text-muted">Cambia el nombre de cada columna como aparece en el formato de tu fondo, ordénalas y quita las que no pida. Los números vacíos salen en 0 y los textos en N/A, en mayúscula.</p>
        <ol className="grid gap-2">{cols.map((c, i) => (
          <li key={c.campo} className="rounded-xl border border-line p-2 grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2">
            <span className="num text-muted text-center">{i + 1}</span>
            <label className="grid text-[12px] text-muted min-w-0">{campos.find((x) => x.campo === c.campo)?.titulo}
              <input value={c.titulo} maxLength={80} aria-label={`Título de la columna ${i + 1}`} onChange={(e) => { const n = [...cols]; n[i] = { ...c, titulo: e.target.value }; setCols(n); setPropia(true); }} className="campo text-sm" />
            </label>
            <span className="flex gap-1">
              <button type="button" onClick={() => mover(i, i - 1)} disabled={i === 0} className="btn-borde h-9 px-2" aria-label={`Subir ${c.titulo}`}>↑</button>
              <button type="button" onClick={() => mover(i, i + 1)} disabled={i === cols.length - 1} className="btn-borde h-9 px-2" aria-label={`Bajar ${c.titulo}`}>↓</button>
              <button type="button" onClick={() => { if (cols.length > 1) { setCols(cols.filter((_, j) => j !== i)); setPropia(true); } }} disabled={cols.length <= 1} className="btn-borde h-9 px-2" aria-label={`Quitar ${c.titulo}`}>✕</button>
            </span>
          </li>
        ))}</ol>
        {libres.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid text-sm text-muted min-w-0 flex-1 sm:flex-none sm:w-80">Agregar columna
              <select value={nuevo} onChange={(e) => setNuevo(e.target.value)} className="campo"><option value="">Elige un campo…</option>{libres.map((c) => <option key={c.campo} value={c.campo}>{c.titulo}</option>)}</select>
            </label>
            <button type="button" disabled={!nuevo || cols.length >= 40} onClick={() => { const c = campos.find((x) => x.campo === nuevo); if (c) { setCols([...cols, c]); setPropia(true); setNuevo(""); } }} className="btn-borde">Agregar</button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={enviando || demo} className="btn-oscuro">{enviando ? "Guardando…" : "Guardar configuración"}</button>
        {estado.ok && <p role="status" className="text-sm font-semibold text-cruz">{estado.ok}</p>}
        {estado.error && <p role="alert" className="text-sm text-alerta">{estado.error}</p>}
      </div>
    </form>
  );
}
