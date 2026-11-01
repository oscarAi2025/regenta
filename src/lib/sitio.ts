// Datos públicos de la página comercial. La URL final se define con REGENTA_URL al publicar (dominio aún por registrar).
export const SITIO = process.env.REGENTA_URL ?? "http://localhost:4500";
export const WHATSAPP = "573212141970";
export const CORREO = "gerencia@farmagenericoscolombia.com";
export const TELEFONO = "+57 321 214 1970";
export const wa = (texto: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;
