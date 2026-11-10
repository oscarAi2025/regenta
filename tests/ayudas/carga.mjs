// Con loading.tsx la pantalla llega primero como «Cargando» y React la cambia por la real unos milisegundos después
// (React 19 agrupa esos cambios). Tras navegar, las pruebas esperan a que ya no haya «Cargando».
export function esperarCarga(pagina) {
  const proto = Object.getPrototypeOf(pagina);
  if (proto.__conCarga) return;
  proto.__conCarga = true;
  const listo = (p) => p.locator('[role="status"][aria-label="Cargando"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  for (const m of ["goto", "waitForURL", "reload", "goBack"]) {
    const original = proto[m];
    proto[m] = async function (...a) { const r = await original.apply(this, a); await listo(this); return r; };
  }
}
