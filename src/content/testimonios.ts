/** Lo que dicen clientes reales de Regenta (los aportó Oscar el 21/11/2026, con nombre, negocio y ciudad).
 *  Solo citas reales y autorizadas: no se inventan ni se reescriben más allá de la ortografía. */
export type Testimonio = { cita: string; nombre: string; cargo?: string; negocio: string; ciudad: string };

export const TESTIMONIOS: Testimonio[] = [
  { cita: "Regenta es lo que necesitábamos hace años. Regenta se adapta a nosotros, no nosotros a Regenta.", nombre: "Carmen Gálvez", negocio: "Droguería Rovira", ciudad: "Ibagué" },
  { cita: "El mejor sistema POS y de facturación para farmacias de Colombia. Después de probar más de seis, Regenta es la clave de mi gestión de facturación.", nombre: "Luis Salverón Pérez", negocio: "Droguería Salud Plus", ciudad: "Medellín" },
  { cita: "El programa del sector farmacéutico para Colombia, sin duda.", nombre: "Miguel Santos Guerra", cargo: "Gerente", negocio: "Distribuciones Insumos La Costa", ciudad: "Cali" },
];
