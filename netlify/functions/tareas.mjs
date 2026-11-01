// Tarea programada de Netlify (cada hora, en UTC): llama a /api/tareas, que manda los correos que tocan, programa los
// recordatorios de renovación, procesa la cola DIAN y cada 6 horas trae las alertas del INVIMA.
// Solo corre en el despliegue publicado (no en vistas previas). Se prueba con «Run now» en el panel de Netlify.
// Variables (en el panel de Netlify, con alcance «Functions»): REGENTA_CRON_KEY y REGENTA_URL.
export default async () => {
  const base = process.env.REGENTA_URL ?? process.env.URL;
  const clave = process.env.REGENTA_CRON_KEY;
  if (!base || !clave) { console.error("Faltan REGENTA_URL o REGENTA_CRON_KEY"); return; }
  const r = await fetch(`${base}/api/tareas`, { method: "POST", headers: { authorization: `Bearer ${clave}` } });
  console.log("tareas", r.status, (await r.text()).slice(0, 2000));
};

export const config = { schedule: "@hourly" };
