import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Con canal alfa para que funcionen clases como bg-surface/95 o bg-ink/40.
        "ink": "rgb(var(--ink-rgb) / <alpha-value>)", "paper": "rgb(var(--paper-rgb) / <alpha-value>)", "surface": "rgb(var(--surface-rgb) / <alpha-value>)", "line": "rgb(var(--line-rgb) / <alpha-value>)", "muted": "rgb(var(--muted-rgb) / <alpha-value>)", "cruz": "rgb(var(--cruz-rgb) / <alpha-value>)", "cruz-ink": "rgb(var(--cruz-ink-rgb) / <alpha-value>)", "cruz-soft": "rgb(var(--cruz-soft-rgb) / <alpha-value>)", "alerta": "rgb(var(--alerta-rgb) / <alpha-value>)", "alerta-soft": "rgb(var(--alerta-soft-rgb) / <alpha-value>)", "aviso": "rgb(var(--aviso-rgb) / <alpha-value>)", "aviso-soft": "rgb(var(--aviso-soft-rgb) / <alpha-value>)", "marca": "rgb(var(--marca-rgb) / <alpha-value>)",
      },
      fontFamily: { sans: ["Barlow", "system-ui", "sans-serif"], cond: ["'Barlow Semi Condensed'", "Barlow", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
