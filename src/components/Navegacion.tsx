"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/inicio", label: "Inicio", roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M4 11l8-7 8 7v9h-5v-6H9v6H4z" },
  { href: "/caja", label: "Caja", roles: ["dueno", "admin", "cajero"], d: "M4 7h16v12H4zM8 7V4h8v3M8 12h3M8 15h5" },
  { href: "/turno", label: "Turno", roles: ["dueno", "admin", "cajero"], d: "M12 7v5l3 2M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0" },
  { href: "/ventas", label: "Ventas", roles: ["dueno", "admin", "cajero"], d: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" },
  { href: "/clientes", label: "Clientes", roles: ["dueno", "admin"], d: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a3 3 0 1 0 0-6M18 14c2.2.6 4 2.9 4 6" },
  { href: "/cartera", label: "Cartera", roles: ["dueno", "admin"], d: "M3 7h18v12H3zM3 11h18M7 15h4M16 4l-3 3" },
  { href: "/productos", label: "Productos", roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M7 4h10l3 4v12H4V8zM4 8h16M10 12h4" },
  { href: "/reportes", label: "Reportes", roles: ["dueno", "admin"], d: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/prediccion", label: "Predicción", roles: ["dueno", "admin", "bodeguero"], d: "M4 19h16M6 16l4-5 3 3 5-7M15 7h3v3" },
  { href: "/alertas", label: "Alertas", roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M12 4l9 16H3zM12 10v4M12 17h.01" },
  { href: "/equipo", label: "Mi droguería", roles: ["dueno"], d: "M3 21V9l9-6 9 6v12M9 21v-6h6v6M3 21h18" },
  { href: "/inventario", label: "Inventario", roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8" },
  { href: "/cuenta", label: "Mi cuenta", soloCelular: true, roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" },
];

// Grupos del menú lateral en escritorio (en el celular la barra es horizontal y sin títulos).
const GRUPOS: [string, string[]][] = [
  ["", ["/inicio"]],
  ["Vender", ["/caja", "/turno", "/ventas", "/clientes", "/cartera"]],
  ["Inventario", ["/productos", "/inventario", "/prediccion", "/alertas"]],
  ["Gestión", ["/reportes", "/equipo", "/cuenta"]],
];

export function Navegacion({ rol, demo = false }: { rol: string; demo?: boolean }) {
  const p = usePathname();
  async function salir() { await fetch("/api/sesion", { method: "DELETE" }); location.href = demo ? "/demo/gracias" : "/entrar"; } // la demo termina en la oferta, no en la pantalla de entrar
  const visibles = ITEMS.filter((i) => i.roles.includes(rol));
  const icono = (d: string) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" className="shrink-0"><path d={d} /></svg>;
  return (
    <nav className="flex lg:flex-col items-center lg:items-stretch gap-1 lg:gap-0 lg:mt-4 flex-1 w-full min-h-0 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(90deg,#000_85%,transparent)] lg:[mask-image:none]" aria-label="Principal">
      {GRUPOS.map(([titulo, rutas]) => {
        const items = rutas.map((r) => visibles.find((i) => i.href === r)).filter((i): i is (typeof ITEMS)[number] => !!i);
        if (!items.length) return null;
        return (
          <div key={titulo || "inicio"} className="contents lg:block lg:mb-2">
            {titulo && <p className="hidden lg:block px-3 pt-1.5 pb-1 text-[11.5px] font-semibold text-white/45">{titulo}</p>}
            {items.map((i) => {
              const on = p.startsWith(i.href);
              return (
                <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
                  className={`${"soloCelular" in i ? "lg:hidden " : ""}relative flex flex-col lg:flex-row items-center gap-1 lg:gap-3 rounded-xl lg:rounded-lg px-2 lg:px-3 py-2 lg:py-[6px] min-w-16 lg:min-w-0 lg:w-full text-[12px] lg:text-[14.5px] font-medium shrink-0 transition-colors ${on ? "text-white bg-white/12 lg:before:absolute lg:before:left-0 lg:before:top-1.5 lg:before:bottom-1.5 lg:before:w-[3px] lg:before:rounded-full lg:before:bg-teal-300" : "text-white/70 hover:text-white hover:bg-white/6"}`}>
                  {icono(i.d)}
                  <span className="whitespace-nowrap">{i.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
      <button onClick={salir} className="lg:mt-auto ml-auto lg:ml-0 flex flex-col lg:flex-row items-center gap-1 lg:gap-3 rounded-xl lg:rounded-lg px-2 lg:px-3 py-2 lg:py-[7px] min-w-16 lg:w-full text-[12px] lg:text-[14.5px] text-white/70 hover:text-white hover:bg-white/6 shrink-0 lg:border-t lg:border-white/10 lg:rounded-none lg:pt-3">
        {icono("M14 4h5v16h-5M10 12h9M7 9l-3 3 3 3")}
        <span>Salir</span>
      </button>
    </nav>
  );
}
