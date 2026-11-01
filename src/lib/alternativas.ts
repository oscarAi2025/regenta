/** Pistas para buscar alternativas de un producto agotado: el principio activo (la palabra entre paréntesis o la primera
 *  palabra del nombre) y la concentración (p. ej. «500 mg»). Es una ayuda para el mostrador: el regente confirma. */
export function pistas(nombre: string) {
  const n = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const par = n.match(/\(([a-z]{4,})[^)]*\)/)?.[1];
  const primera = n.match(/^[a-z]{4,}/)?.[0];
  const principio = par ?? primera ?? null;
  const c = n.match(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|g|ml|ui|%)/);
  return { principio, concentracion: c ? { valor: c[1].replace(",", "."), unidad: c[2] } : null };
}
