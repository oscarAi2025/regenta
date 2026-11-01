"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/caja", label: "Caja", roles: ["dueno", "admin", "cajero"], d: "M4 7h16v12H4zM8 7V4h8v3M8 12h3M8 15h5" },
  { href: "/inventario", label: "Inventario", roles: ["dueno", "admin", "cajero", "bodeguero"], d: "M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8" },
];

export function Navegacion({ rol }: { rol: string }) {
  const p = usePathname();
  async function salir() { await fetch("/api/sesion", { method: "DELETE" }); location.href = "/entrar"; }
  return (
    <nav className="flex lg:flex-col items-center gap-1 lg:mt-6 flex-1 w-full" aria-label="Principal">
      {ITEMS.filter((i) => i.roles.includes(rol)).map((i) => {
        const on = p.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 w-16 text-[12px] font-medium ${on ? "bg-white/12 text-white" : "text-white/65 hover:text-white"}`}
            style={on ? { background: "rgba(255,255,255,.12)" } : undefined}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d={i.d} /></svg>
            {i.label}
          </Link>
        );
      })}
      <button onClick={salir} className="lg:mt-auto ml-auto lg:ml-0 flex flex-col items-center gap-1 rounded-xl px-2 py-2 w-16 text-[12px] text-white/65 hover:text-white">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M14 4h5v16h-5M10 12h9M7 9l-3 3 3 3" /></svg>
        Salir
      </button>
    </nav>
  );
}
