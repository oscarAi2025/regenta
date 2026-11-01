/** Lo que trae cualquier plan y ningún POS genérico: IA predictiva, apoyo en ventas, gestión y formación. */
const COSAS: [string, string, string, string][] = [
  ["IA predictiva", "Qué pedir, qué se te va a vencer y cuál es tu día fuerte, calculado con tus ventas. Y un asistente que responde con tus datos.", "from-violet-500 to-indigo-600", "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"],
  ["Apoyo en ventas", "Qué ofrecer primero antes de que se venza y, si algo está agotado, qué tienes que lo reemplace.", "from-amber-400 to-orange-500", "M4 19h16M6 16l4-5 3 3 5-7M15 7h3v3"],
  ["Gestión completa", "Facturación DIAN, inventario por lote, cartera, alertas del INVIMA, roles y auditoría en un solo lugar.", "from-teal-500 to-cyan-600", "M4 7h16v12H4zM8 7V4h8v3M8 12h8M8 15h5"],
  ["Formación", "Capacitamos a tu equipo para que saque provecho desde el primer día. Gente del sector enseñándole a gente del sector.", "from-sky-500 to-blue-700", "M3 9l9-5 9 5-9 5zM7 11v5c0 1.5 2.5 3 5 3s5-1.5 5-3v-5"],
];
export function IncluyeTodo({ titulo = "Todos los planes incluyen" }: { titulo?: string }) {
  return (
    <div>
      <p className="font-cond text-[26px] sm:text-[32px] leading-tight" style={{ fontWeight: 700 }}>{titulo}</p>
      <ul className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {COSAS.map(([t, d, g, ico]) => (
          <li key={t} className={`rounded-3xl bg-gradient-to-br ${g} text-white p-5`}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ico} /></svg>
            <p className="mt-3 font-cond text-[24px] leading-tight" style={{ fontWeight: 700 }}>{t}</p>
            <p className="mt-1.5 text-white/90 text-[15px] leading-relaxed">{d}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
