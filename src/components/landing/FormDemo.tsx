"use client";
import { useState } from "react";

import { WHATSAPP as WA } from "@/lib/sitio";

export function FormDemo() {
  const [estado, setEstado] = useState<"" | "enviando" | "ok">("");
  const [error, setError] = useState("");
  const [nombre, setNombre] = useState("");

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setEstado("enviando");
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const r = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...d, origen: typeof location !== "undefined" ? location.pathname + location.search : null }) }).catch(() => null);
    if (!r) { setError("Sin conexión. Escríbenos por WhatsApp."); setEstado(""); return; }
    if (r.ok) { setNombre(d.nombre); setEstado("ok"); return; }
    setError((await r.json().catch(() => ({}))).error ?? "No se pudo enviar. Escríbenos por WhatsApp."); setEstado("");
  }

  if (estado === "ok") return (
    <div role="status" className="rounded-2xl bg-white/10 p-6">
      <p className="font-cond text-3xl" style={{ fontWeight: 700 }}>Listo, {nombre.split(" ")[0]}.</p>
      <p className="mt-2 text-white/80">Te escribimos al celular para agendar la demostración. Si prefieres no esperar, abre WhatsApp y te atendemos de una vez.</p>
      <a href={`https://wa.me/${WA}?text=${encodeURIComponent("Hola, acabo de pedir la demo de Regenta para mi droguería o distribuidora.")}`} className="btn-cta mt-5">Abrir WhatsApp</a>
    </div>
  );

  return (
    <form onSubmit={enviar} className="grid sm:grid-cols-2 gap-3 text-ink">
      <div><label htmlFor="d-nombre" className="etiqueta text-white">Tu nombre</label><input id="d-nombre" name="nombre" required autoComplete="name" className="campo" /></div>
      <div><label htmlFor="d-drogueria" className="etiqueta text-white">Droguería o empresa</label><input id="d-drogueria" name="drogueria" required autoComplete="organization" className="campo" /></div>
      <div><label htmlFor="d-tel" className="etiqueta text-white">Celular / WhatsApp</label><input id="d-tel" name="telefono" required type="tel" inputMode="tel" autoComplete="tel" className="campo" /></div>
      <div><label htmlFor="d-ciudad" className="etiqueta text-white">Ciudad</label><input id="d-ciudad" name="ciudad" autoComplete="address-level2" className="campo" /></div>
      <div className="sm:col-span-2"><label htmlFor="d-cajas" className="etiqueta text-white">¿Cuántas cajas registradoras tienes?</label>
        <select id="d-cajas" name="cajas" className="campo" defaultValue="1"><option value="1">1</option><option value="2-3">2 a 3</option><option value="4+">4 o más / varias sedes</option><option value="distribuidor">Soy distribuidor</option></select></div>
      <div className="hidden" aria-hidden="true"><label htmlFor="d-web">Web</label><input id="d-web" name="web" tabIndex={-1} autoComplete="off" /></div>
      {error && <p role="alert" className="sm:col-span-2 text-[#ffb4ab] font-semibold">{error}</p>}
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3 pt-1">
        <button disabled={estado === "enviando"} className="btn-cta h-12 px-6 text-lg">{estado === "enviando" ? "Enviando…" : "Pedir demostración"}</button>
        <p className="text-sm text-white/65 max-w-[30em]">Al enviar autorizas a Farmagenéricos Colombia a usar estos datos solo para contactarte sobre Regenta (Ley 1581 de 2012). Puedes pedir que los borremos escribiendo a gerencia@farmagenericoscolombia.com.</p>
      </div>
    </form>
  );
}
