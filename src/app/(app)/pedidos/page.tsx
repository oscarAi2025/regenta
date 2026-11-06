import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { TIPOS, puedePedidos, type TipoPedido } from "@/lib/pedidos";
import { contarPedidos, leerFiltroPedidos, listarPedidos, type FiltroPedidos } from "@/lib/pedidos-servidor";
import { TarjetaPedido } from "./TarjetaPedido";

export const metadata = { title: "Pedidos" };

const ESTADOS_FILTRO: [FiltroPedidos["estado"], string][] = [["pendientes", "Pendientes"], ["cobrado", "Cobrados"], ["cancelado", "Cancelados"], ["todos", "Todos"]];
const qs = (f: FiltroPedidos, cambio: Partial<Record<"tipo" | "estado" | "q", string | null>>) => {
  const x = { tipo: f.tipo as string | null, estado: f.estado === "pendientes" ? null : f.estado as string | null, q: f.q || null, ...cambio };
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(x)) if (v && !(k === "estado" && v === "pendientes")) u.set(k, v);
  const s = u.toString();
  return s ? `/pedidos?${s}` : "/pedidos";
};

export default async function Pedidos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedePedidos.armar(s.rol)) redirect("/inicio?aviso=permiso");
  const f = leerFiltroPedidos(await searchParams);
  const { pedidos, n, empresa } = await comoUsuario(s, async (c) => ({
    pedidos: await listarPedidos(c, s.empresa, f, 100),
    n: await contarPedidos(c, s.empresa),
    empresa: (await c.query(`select coalesce(nombre_comercial, razon_social) n from empresas where id = $1`, [s.empresa])).rows[0]?.n as string,
  }));
  const cobra = puedePedidos.cobrar(s.rol);
  const filtrado = !!(f.tipo || f.q || f.estado !== "pendientes");
  const contador = (tipo: TipoPedido, titulo: string, valor: number, nota: string) => {
    const activo = f.tipo === tipo && f.estado === "pendientes";
    return (
      <a href={qs(f, { tipo: activo ? null : tipo, estado: null })} aria-current={activo ? "true" : undefined}
        className={`tarjeta px-4 py-3.5 transition-colors hover:border-ink ${activo ? "border-ink ring-2 ring-ink/15" : ""}`}>
        <span className="block text-sm text-muted">{titulo}</span>
        <span className="block num titulo text-[30px] leading-tight">{valor.toLocaleString("es-CO")}</span>
        <span className="block text-[13px] text-muted mt-0.5">{nota}</span>
      </a>
    );
  };

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Pedidos" sub="Ventas en espera, domicilios y cotizaciones. Nada aparta existencias: se cobran al precio del día.">
        <a href="/pedidos/nuevo" className="btn-primario">Nuevo pedido o cotización</a>
        {cobra && <Link href="/caja" className="btn-borde">Ir a la caja</Link>}
      </Cabecera>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Pendientes por tipo">
        {contador("espera", "En espera", n.espera, "Cualquier caja las cobra")}
        {contador("domicilio", "Domicilios", n.domicilio + n.en_camino, n.en_camino ? `${n.en_camino} en camino` : "Ninguno en camino")}
        {contador("cotizacion", "Cotizaciones", n.cotizacion, n.vencida ? `${n.vencida} vencida${n.vencida === 1 ? "" : "s"}` : "Vigentes")}
        <a href="/pedidos/nuevo" className="tarjeta px-4 py-3.5 hover:border-ink grid content-center">
          <span className="font-semibold">Armar un pedido</span>
          <span className="text-[13px] text-muted mt-0.5">Cotización para enviar por WhatsApp o domicilio para despachar</span>
        </a>
      </section>

      <div className="tarjeta p-3 grid gap-3">
        <nav className="flex flex-wrap gap-1.5" aria-label="Tipo">
          {([[null, "Todos"], ["espera", "En espera"], ["domicilio", "Domicilios"], ["cotizacion", "Cotizaciones"]] as const).map(([t, nombre]) => (
            <a key={nombre} href={qs(f, { tipo: t })} aria-current={f.tipo === t ? "page" : undefined}
              className={`h-9 px-3 rounded-lg text-sm font-semibold inline-flex items-center ${f.tipo === t ? "bg-ink text-white" : "text-muted hover:text-ink hover:bg-paper"}`}>{nombre}</a>
          ))}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-1.5" aria-label="Estado">
            {ESTADOS_FILTRO.map(([e, nombre]) => (
              <a key={e} href={qs(f, { estado: e })} aria-current={f.estado === e ? "page" : undefined}
                className={`h-8 px-3 rounded-full border text-sm inline-flex items-center ${f.estado === e ? "border-ink bg-ink text-white" : "border-line text-muted hover:border-ink hover:text-ink"}`}>{nombre}</a>
            ))}
          </nav>
          <form className="flex gap-2 w-full sm:w-auto" role="search" aria-label="Buscar pedidos">
            {f.tipo && <input type="hidden" name="tipo" value={f.tipo} />}
            {f.estado !== "pendientes" && <input type="hidden" name="estado" value={f.estado} />}
            <label htmlFor="pd-q" className="sr-only">Buscar por número, nombre o teléfono</label>
            <input id="pd-q" type="search" name="q" defaultValue={f.q} maxLength={60} placeholder="Número, nombre o teléfono" className="campo h-10 min-w-0 flex-1 sm:w-64" />
            <button className="btn-oscuro h-10">Buscar</button>
          </form>
        </div>
      </div>

      {pedidos.length === 0 ? (
        <section className="tarjeta px-5 py-12 text-center grid gap-3 justify-items-center">
          <p className="titulo text-xl">{filtrado ? "Ningún pedido cumple estos filtros" : "No hay pedidos pendientes"}</p>
          <p className="text-muted max-w-md">{filtrado ? "Prueba con otro tipo o estado, o quita los filtros." : `En la caja, ${cobra ? "F4 pone una venta en espera y los botones «Domicilio» y «Cotizar» la guardan como pedido" : "arma un pedido o una cotización con el botón de arriba"}. Aquí verás todos los de la droguería.`}</p>
          {filtrado && <a href="/pedidos" className="btn-borde">Quitar filtros</a>}
        </section>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2" aria-label="Pedidos">
          {pedidos.map((p) => <TarjetaPedido key={p.id} inicial={p} cobra={cobra} empresa={empresa} />)}
        </ul>
      )}
      {pedidos.length === 100 && <p className="text-sm text-muted">Se muestran los 100 más recientes. Usa los filtros o la búsqueda para encontrar otros.</p>}
      <p className="text-sm text-muted max-w-3xl">{TIPOS.cotizacion}: los precios están sujetos a cambio; al convertirla en venta la caja muestra «antes y ahora» si alguno cambió. Un domicilio cancelado no mueve existencias.</p>
    </main>
  );
}
