"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/inicio", label: "Inicio", roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M4 11l8-7 8 7v9h-5v-6H9v6H4z" },
  { href: "/caja", label: "Caja", roles: ["dueno", "admin", "cajero"], d: "M4 7h16v12H4zM8 7V4h8v3M8 12h3M8 15h5" },
  { href: "/ventas", label: "Ventas", roles: ["dueno", "admin", "cajero"], d: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" },
  { href: "/cartera", label: "Cartera", roles: ["dueno", "admin"], d: "M3 7h18v12H3zM3 11h18M7 15h4M16 4l-3 3" },
  { href: "/productos", label: "Productos", roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M7 4h10l3 4v12H4V8zM4 8h16M10 12h4" },
  { href: "/prediccion", label: "Predicción", roles: ["dueno", "admin", "bodeguero"], d: "M4 19h16M6 16l4-5 3 3 5-7M15 7h3v3" },
  { href: "/alertas", label: "Alertas", roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M12 4l9 16H3zM12 10v4M12 17h.01" },
  { href: "/inventario", label: "Inventario", roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8" },
];

export function Navegacion({ rol }: { rol: string }) {
  const p = usePathname();
  async function salir() { await fetch("/api/sesion", { method: "DELETE" }); location.href = "/entrar"; }
  return (
    <nav className="flex lg:flex-col items-center gap-1 lg:mt-6 flex-1 w-full overflow-x-auto" aria-label="Principal">
      {ITEMS.filter((i) => i.roles.includes(rol)).map((i) => {
        const on = p.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 min-w-16 text-[12px] font-medium shrink-0 ${on ? "text-white" : "text-white/65 hover:text-white"}`}
            style={on ? { background: "rgba(255,255,255,.12)" } : undefined}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d={i.d} /></svg>
            {i.label}
          </Link>
        );
      })}
      <button onClick={salir} className="lg:mt-auto ml-auto lg:ml-0 flex flex-col items-center gap-1 rounded-xl px-2 py-2 min-w-16 text-[12px] text-white/65 hover:text-white shrink-0">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M14 4h5v16h-5M10 12h9M7 9l-3 3 3 3" /></svg>
        Salir
      </button>
    </nav>
  );
}
