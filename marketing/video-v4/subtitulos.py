# Subtítulos V4 desde los tiempos reales de cada palabra de la locución: .srt (texto plano) y .ass (palabras clave en turquesa).
import json
TL = json.load(open("timeline.json")); PW = json.load(open("voz/palabras.json")); L = {l["k"]: l for l in TL["lineas"]}
# (línea, índice de la primera palabra del tramo, texto del tramo)
CUES = [("01", 0, "¡Tu droguería puede estar\nen otro nivel!"), ("02", 0, "¡Llegó Regenta!"), ("02", 2, "La tecnología que te ayuda\na tenerlo todo bajo control."),
  ("03", 0, "Vende ágil, con tu punto de venta"), ("03", 7, "y factura electrónica,\nen la misma caja."),
  ("04", 0, "Organiza tu inventario,\ncontrola cada lote"), ("04", 6, "y anticípate a los vencimientos."), ("05", 0, "Y aquí viene lo mejor…"), ("06", 0, "¡Regenta IA!"),
  ("07", 0, "Analiza tus ventas\ny te dice qué reponer,"), ("07", 8, "qué productos están quietos\ny qué merece tu atención."),
  ("08", 0, "Alertas, temperatura,\ncontrol especial e indicadores,"), ("08", 6, "con información clara."),
  ("09", 0, "Menos enredos. Más control."), ("09", 4, "¡Y más tiempo para hacer\ncrecer tu negocio!"),
  ("10", 0, "Regenta.\nTu droguería, en orden."), ("11", 0, "¡Entra a regenta.pro y pruébala gratis!")]
CLAVE = ["Regenta IA", "regenta.pro", "Regenta", "otro nivel", "factura electrónica", "cada lote", "vencimientos", "Regenta IA", "qué reponer", "control especial", "Más control", "en orden", "gratis", "bajo control"]
t = []
for i, (k, w, tx) in enumerate(CUES):
    a = L[k]["ini"] + max(0, PW[k][w][0]) - .05
    sig = CUES[i + 1] if i + 1 < len(CUES) else None
    b = L[k]["ini"] + L[k]["dur"] + .25
    if sig and sig[0] == k: b = L[k]["ini"] + PW[k][sig[1]][0] - .07
    if sig: b = min(b, L[sig[0]]["ini"] + max(0, PW[sig[0]][sig[1]][0]) - .1)
    t.append((a, b, tx, k))
fmt = lambda s, c=",": "%02d:%02d:%02d%s%03d" % (s // 3600, s % 3600 // 60, s % 60, c, round(s % 1 * 1000) % 1000)
open("REGENTA-LANZAMIENTO-V4.srt", "w").write("\n".join(f"{i+1}\n{fmt(a)} --> {fmt(b)}\n{x}\n" for i, (a, b, x, _) in enumerate(t)))
def ass_t(s): return "%d:%02d:%05.2f" % (s // 3600, s % 3600 // 60, s % 60)
def resaltar(x):
    for c in sorted(set(CLAVE), key=len, reverse=True):
        if c in x and "\\c" not in x.split(c)[0][-12:]: x = x.replace(c, "{\\c&HA6B814&}" + c + "{\\c&HFFFFFF&}", 1); break
    return x.replace("\n", "\\N")
cab = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: S,Barlow Semi Condensed,52,&H00FFFFFF,&H00FFFFFF,&H00402508,&H96402508,1,0,0,0,100,100,0,0,3,14,0,2,200,200,62,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
open("subs.ass", "w").write(cab + "\n".join(f"Dialogue: 0,{ass_t(a)},{ass_t(b)},S,,0,0,{14 if k == "11" else 0},,{resaltar(x)}" for a, b, x, k in t) + "\n")
for a, b, x, k in t: print(f"{a:6.2f} {b:6.2f} {x!r}")
