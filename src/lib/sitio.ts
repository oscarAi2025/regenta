// Datos públicos de la página comercial. La URL final se define con REGENTA_URL al publicar (dominio aún por registrar).
// En un despliegue (Netlify o Vercel) sin REGENTA_URL fallaría el SEO (canonical, sitemap y datos estructurados con
// localhost): se detiene el build en vez de publicar algo roto.
if (!process.env.REGENTA_URL && (process.env.NETLIFY || process.env.VERCEL)) throw new Error("Falta REGENTA_URL (la URL pública del sitio)");
export const SITIO = process.env.REGENTA_URL ?? "http://localhost:4500";
export const WHATSAPP = "573212141970";
export const CORREO = "gerencia@farmagenericoscolombia.com";
/** Texto exacto de la autorización de correos comerciales: se guarda con cada solicitud como prueba (Ley 1581, art. 17.b). */
export const TEXTO_CORREOS = "Quiero recibir por correo consejos y novedades de Regenta para droguerías. Puedo darme de baja con un clic en cualquier correo.";
export const LINKEDIN = "https://www.linkedin.com/company/regenta-ia-%C2%B7-facturaci%C3%B3n-para-farmacias/";
/** Perfiles de Regenta en directorios de software y redes: enlace en el pie y «sameAs» en los datos estructurados. */
export const PERFILES: [string, string][] = [
  ["G2", "https://www.g2.com/products/farmagenericos-colombia-regenta/reviews"],
  ["Capterra", "https://www.capterra.com/p/10297276/Regenta/"],
  ["GetApp", "https://www.getapp.com/all-software/a/regenta-1/"],
];
export const TELEFONO = "+57 321 214 1970";
export const wa = (texto: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;
