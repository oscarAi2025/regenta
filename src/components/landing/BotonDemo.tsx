/** Botón «Probar la demo»: formulario POST al propio sitio (un clic, sin registro). */
export function BotonDemo({ texto = "Probar la demo ahora", className = "btn-primario h-14 px-7 text-lg", rol }: { texto?: React.ReactNode; className?: string; rol?: "cajero" | "bodega" }) {
  return (
    <form method="post" action="/demo" className="contents">
      {rol && <input type="hidden" name="rol" value={rol} />}
      <button type="submit" className={className}>{texto}</button>
    </form>
  );
}
