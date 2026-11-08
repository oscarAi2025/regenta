"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [["/admin", "Resumen"], ["/admin/clientes", "Clientes"], ["/admin/clientes/nuevo", "Nuevo cliente"], ["/admin/pagos", "Pagos"], ["/admin/solicitudes", "Solicitudes de demo"], ["/admin/demo", "Visitas a la demo"], ["/admin/correos", "Correos"], ["/admin/sistema", "Sistema"], ["/admin/bitacora", "Bitácora"]] as const;

export function NavAdmin() {
  const p = usePathname();
  async function salir() { await fetch("/api/admin/salir", { method: "POST" }); location.href = "/admin/entrar"; }
  return (
    <nav aria-label="Consola" className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
      {ITEMS.map(([h, t]) => {
        const on = h === "/admin" ? p === "/admin" : p === h || (p.startsWith(h + "/") && !(h === "/admin/clientes" && p === "/admin/clientes/nuevo"));
        return <Link key={h} href={h} aria-current={on ? "page" : undefined} className={`shrink-0 rounded-xl px-3 py-2.5 text-[15px] font-semibold ${on ? "bg-white/12 text-white" : "text-white/65 hover:text-white"}`} style={on ? { background: "rgba(255,255,255,.12)" } : undefined}>{t}</Link>;
      })}
      <button onClick={salir} className="shrink-0 lg:mt-6 rounded-xl px-3 py-2.5 text-left text-[15px] text-white/65 hover:text-white">Salir de la consola</button>
    </nav>
  );
}
