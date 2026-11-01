import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)", paper: "var(--paper)", surface: "var(--surface)", line: "var(--line)", muted: "var(--muted)",
        cruz: "var(--cruz)", "cruz-ink": "var(--cruz-ink)", "cruz-soft": "var(--cruz-soft)",
        alerta: "var(--alerta)", "alerta-soft": "var(--alerta-soft)", aviso: "var(--aviso)", "aviso-soft": "var(--aviso-soft)",
        marca: "var(--marca)",
      },
      fontFamily: { sans: ["Barlow", "system-ui", "sans-serif"], cond: ["'Barlow Semi Condensed'", "Barlow", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
