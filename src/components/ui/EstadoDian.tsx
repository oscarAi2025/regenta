export function EstadoDian({ e }: { e: string | null }) {
  const t = e === "aceptado" ? ["DIAN ✓", "text-cruz"] : e === "rechazado" ? ["Rechazado", "text-alerta"] : ["Enviando", "text-aviso"];
  return <span className={`text-[13px] font-semibold ${t[1]}`}>{t[0]}</span>;
}
