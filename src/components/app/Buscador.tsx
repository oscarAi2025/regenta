"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Item = { id: string; titulo: string; sub?: string; ir: () => void };
const PAGINAS = [
  { href: "/inicio", t: "Inicio", roles: "*" }, { href: "/caja", t: "Caja: vender", roles: "dueno,admin,cajero" }, { href: "/ventas", t: "Ventas del día", roles: "dueno,admin,cajero" }, { href: "/cartera", t: "Cartera: lo que te deben", roles: "dueno,admin" },
  { href: "/productos", t: "Productos", roles: "*" }, { href: "/productos/nuevo", t: "Agregar producto", roles: "dueno,admin" }, { href: "/productos/importar", t: "Cargar productos desde Excel", roles: "dueno,admin" },
  { href: "/inventario", t: "Inventario y lotes", roles: "*" }, { href: "/inventario/recibir", t: "Recibir mercancía", roles: "dueno,admin,bodeguero" },
  { href: "/prediccion", t: "Pedido sugerido", roles: "dueno,admin,bodeguero" }, { href: "/prediccion?ver=vencimiento", t: "Lo que se puede vencer", roles: "dueno,admin,bodeguero" },
  { href: "/alertas", t: "Alertas INVIMA", roles: "*" },
];

/** Buscador rápido (Ctrl+K o ⌘K): ir a cualquier pantalla, buscar un producto o preguntarle a Regenta IA. */
export function Buscador({ rol }: { rol: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [prods, setProds] = useState<{ id: string; nombre: string; unidades: number; laboratorio: string | null }[]>([]);
  const [sel, setSel] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setAbierto((a) => !a); } };
    const abrir = () => setAbierto(true);
    window.addEventListener("keydown", tecla); window.addEventListener("regenta-buscar", abrir);
    return () => { window.removeEventListener("keydown", tecla); window.removeEventListener("regenta-buscar", abrir); };
  }, []);
  useEffect(() => { if (abierto) { setQ(""); setSel(0); setTimeout(() => campo.current?.focus(), 10); } }, [abierto]);
  useEffect(() => {
    if (q.trim().length < 2) { setProds([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => setProds((j.productos ?? []).slice(0, 6))).catch(() => {}), 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const items: Item[] = useMemo(() => {
    const n = q.trim().toLowerCase();
    const ir = (h: string) => () => { setAbierto(false); router.push(h); };
    const pags = PAGINAS.filter((p) => (p.roles === "*" || p.roles.split(",").includes(rol)) && (!n || p.t.toLowerCase().includes(n))).map((p) => ({ id: p.href, titulo: p.t, ir: ir(p.href) }));
    const pr = prods.map((p) => ({ id: p.id, titulo: p.nombre, sub: `${p.laboratorio ?? "Sin laboratorio"} · ${p.unidades > 0 ? `${p.unidades} und` : "agotado"}`, ir: ir(rol === "dueno" || rol === "admin" ? `/productos/${p.id}` : `/inventario?ver=todos&q=${encodeURIComponent(p.nombre)}`) }));
    const ia = n.length > 3 ? [{ id: "ia", titulo: `Preguntar a Regenta IA: «${q.trim()}»`, ir: () => { setAbierto(false); window.dispatchEvent(new CustomEvent("regenta-ia", { detail: q.trim() })); } }] : [];
    return [...pr, ...pags, ...ia];
  }, [q, prods, rol, router]);

  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-start justify-center pt-[12vh] px-3" onMouseDown={(e) => e.target === e.currentTarget && setAbierto(false)}>
      <div role="dialog" aria-modal="true" aria-label="Buscador rápido" className="w-full max-w-xl tarjeta shadow-2xl overflow-hidden">
        <input ref={campo} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Busca un producto, una pantalla o pregúntale a Regenta IA…" aria-label="Buscar"
          onKeyDown={(e) => {
            if (e.key === "Escape") setAbierto(false);
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === "Enter") items[sel]?.ir();
          }} className="w-full h-14 px-5 text-lg outline-none border-b border-line" />
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {items.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === sel}>
              <button onMouseEnter={() => setSel(i)} onClick={it.ir} className={`w-full text-left px-5 py-2.5 ${i === sel ? "bg-paper" : ""}`}>
                <span className={it.id === "ia" ? "font-semibold text-cruz" : "font-medium"}>{it.titulo}</span>{it.sub && <span className="block text-sm text-muted">{it.sub}</span>}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-5 py-4 text-muted">Sin resultados.</li>}
        </ul>
        <p className="px-5 py-2 text-xs text-muted border-t border-line">↑ ↓ para moverte · Enter para abrir · Esc para cerrar</p>
      </div>
    </div>
  );
}
