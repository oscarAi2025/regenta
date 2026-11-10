import json, subprocess, os, re, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
G = "/tmp/claude-0/-home-claude/cc809211-d237-5d8a-8dcb-ec68bc3fe822/scratchpad/guia"; V = f"{G}/video"
os.makedirs(f"{V}/clips", exist_ok=True); os.makedirs(f"{V}/tmp", exist_ok=True)
g = json.load(open(f"{G}/guion.json")); cajas = json.load(open(f"{G}/pasos/cajas.json"))
INK = (16, 35, 58); TEAL = (94, 234, 212)
F = lambda n, s: ImageFont.truetype(f"{V}/{n}", s)
def dur(f): return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).strip())
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
def correr(args): subprocess.run(args, check=True, capture_output=True)
def tarjeta(png, d, nombre):
    out = f"{V}/clips/{nombre}.mp4"
    if os.path.exists(out): return out
    tmp = out.replace(".mp4", ".tmp.mp4")
    correr(["ffmpeg", "-y", "-framerate", "30", "-i", png, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", str(d),
            "-vf", f"format=yuv420p,loop=-1:1,trim=duration={d},fade=t=in:st=0:d=0.4,fade=t=out:st={d-0.4}:d=0.4", *ENC, "-shortest", tmp])
    os.rename(tmp, out); return out
def logo(size):
    import cairosvg
    return None
def card_inicio():
    im = Image.new("RGB", (1920, 1080), INK); d = ImageDraw.Draw(im)
    try:
        import cairosvg, io
        png = cairosvg.svg2png(url="/home/claude/rg3-int/src/app/icon.svg", output_width=150, output_height=150)
        im.paste(Image.open(io.BytesIO(png)).convert("RGBA"), (160, 300), Image.open(io.BytesIO(png)).convert("RGBA"))
    except Exception: pass
    d.text((340, 305), "Regenta", font=F("BarlowSemiCondensed-Bold.ttf", 110), fill="white")
    d.text((345, 430), "Facturación e IA para el sector farmacéutico", font=F("Barlow-SemiBold.ttf", 40), fill=TEAL)
    d.text((160, 600), "Guía de usuario en video", font=F("BarlowSemiCondensed-Bold.ttf", 86), fill="white")
    d.text((160, 710), "Tu primer acceso y el uso de Regenta, pestaña por pestaña", font=F("Barlow-Medium.ttf", 42), fill=(203, 213, 225))
    d.text((160, 960), "regenta.pro · by Farmagenéricos Colombia", font=F("Barlow-Medium.ttf", 30), fill=(148, 163, 184))
    im.save(f"{V}/tmp/inicio.png")
def card_cap(n, titulo):
    im = Image.new("RGB", (1920, 1080), INK); d = ImageDraw.Draw(im)
    d.rectangle((160, 420, 176, 640), fill=(20, 184, 166))
    d.text((220, 420), f"Capítulo {n:02d}", font=F("Barlow-SemiBold.ttf", 46), fill=TEAL)
    fnt = F("BarlowSemiCondensed-Bold.ttf", 104)
    palabras, lineas, l = titulo.split(), [], ""
    for p in palabras:
        if d.textlength((l + " " + p).strip(), font=fnt) > 1500: lineas.append(l); l = p
        else: l = (l + " " + p).strip()
    lineas.append(l)
    for i, t in enumerate(lineas): d.text((220, 490 + i * 112), t, font=fnt, fill="white")
    im.save(f"{V}/tmp/cap{n:02d}.png")
def card_fin():
    im = Image.new("RGB", (1920, 1080), INK); d = ImageDraw.Draw(im)
    d.text((160, 330), "¿Necesitas ayuda?", font=F("BarlowSemiCondensed-Bold.ttf", 100), fill="white")
    d.text((160, 480), "Pregúntale a Regenta IA dentro del programa", font=F("Barlow-Medium.ttf", 46), fill=(203, 213, 225))
    d.text((160, 560), "WhatsApp +57 321 214 1970", font=F("Barlow-SemiBold.ttf", 54), fill=TEAL)
    d.text((160, 640), "gerencia@farmagenericoscolombia.com", font=F("Barlow-SemiBold.ttf", 54), fill=TEAL)
    d.text((160, 960), "regenta.pro · by Farmagenéricos Colombia", font=F("Barlow-Medium.ttf", 30), fill=(148, 163, 184))
    im.save(f"{V}/tmp/fin.png")
def lienzo(nombre):
    """Imagen 3840×2160 para el zoom: las verticales (celular) van centradas sobre fondo de marca."""
    src = f"{G}/pasos/{nombre}.png"; im = Image.open(src).convert("RGB")
    if abs(im.width / im.height - 16 / 9) < 0.02: return src, im.width / 1920
    fondo = Image.new("RGB", (3840, 2160), (233, 239, 238))
    h = 1960; w = round(im.width * h / im.height)
    if w > 3600: w = 3600; h = round(im.height * w / im.width)
    p = im.resize((w, h), Image.LANCZOS)
    sombra = Image.new("RGBA", (w + 80, h + 80), (0, 0, 0, 0)); ImageDraw.Draw(sombra).rounded_rectangle((40, 50, w + 40, h + 50), 40, fill=(16, 35, 58, 70))
    sombra = sombra.filter(ImageFilter.GaussianBlur(28)); fondo.paste(sombra, ((3840 - w) // 2 - 40, (2160 - h) // 2 - 40), sombra)
    fondo.paste(p, ((3840 - w) // 2, (2160 - h) // 2)); out = f"{V}/tmp/{nombre}-lienzo.png"; fondo.save(out); return out, None
def ass_t(s): h = int(s // 3600); m = int(s % 3600 // 60); return f"{h}:{m:02d}:{s % 60:05.2f}"
def frases(t):
    partes = [x.strip() for x in re.split(r"(?<=[.!?])\s+", t) if x.strip()]
    out = []
    for p in partes:
        while len(p) > 95:
            corte = max(p.rfind(",", 0, 95), p.rfind(" ", 0, 80))
            out.append(p[:corte + 1].strip()); p = p[corte + 1:].strip()
        out.append(p)
    return out
def paso(ci, pi, cap, p):
    nombre = f"{ci:02d}-{pi:02d}"; out = f"{V}/clips/p{nombre}.mp4"
    if os.path.exists(out): return out
    voz = f"{V}/voz/{nombre}.mp3"; dv = dur(voz); d = round(dv + 0.9, 2); N = int(d * 30)
    src, esc = lienzo(p["img"])
    W, H = 3840, 2160; caja = cajas.get(p["img"])
    if caja and esc: cx = (caja["x"] + caja["width"] / 2) * 2; cy = (caja["y"] + caja["height"] / 2) * 2; zf = 1.18 if max(caja["width"], caja["height"]) < 700 else 1.08
    else: cx, cy, zf = W / 2, H / 2, 1.06
    # Zoom lento hacia el control resaltado (empieza a moverse a los 0,6 s).
    z = f"if(lte(on,18),1,1+({zf}-1)*min(1,(on-18)/{max(N-60,1)}))"
    tx = f"({W/2}+({cx}-{W/2})*(zoom-1)/({zf}-1+0.0001))"; ty = f"({H/2}+({cy}-{H/2})*(zoom-1)/({zf}-1+0.0001))"
    x = f"max(0,min(iw-iw/zoom,{tx}-iw/zoom/2))"; y = f"max(0,min(ih-ih/zoom,{ty}-ih/zoom/2))"
    # Subtítulos y rótulo del capítulo
    fr = frases(p["voz"]); tot = sum(len(f) for f in fr); t0 = 0.35; ev = []
    for f_ in fr:
        t1 = t0 + dv * len(f_) / tot; ev.append(f"Dialogue: 0,{ass_t(t0)},{ass_t(min(t1, d - 0.05))},Sub,,0,0,0,,{f_}"); t0 = t1
    ev.append(f"Dialogue: 1,{ass_t(0)},{ass_t(d)},Cap,,0,0,0,,{ci:02d} · {cap}")
    arriba = bool(caja and esc and (caja["y"] + caja["height"]) > 820)
    ass = f"{V}/tmp/{nombre}.ass"
    open(ass, "w").write(f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Barlow Medium,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H2E3A2310,0,0,0,0,100,100,0,0,3,18,0,{8 if arriba else 2},{320 if arriba else 220},220,{110 if arriba else 46},1
Style: Cap,Barlow SemiBold,30,&H00D4EA5E,&H00FFFFFF,&H00000000,&H1A3A2310,0,0,0,0,100,100,0,0,3,12,0,7,40,40,34,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + "\n".join(ev) + "\n")
    tmp = out.replace(".mp4", ".tmp.mp4")
    vf = (f"zoompan=z='{z}':x='{x}':y='{y}':d={N}:s=1920x1080:fps=30,"
          f"subtitles={ass}:fontsdir={V},fade=t=in:st=0:d=0.3,fade=t=out:st={d-0.3}:d=0.3")
    correr(["ffmpeg", "-y", "-i", src, "-i", voz, "-filter_complex", f"[0:v]{vf}[v];[1:a]adelay=350|350,apad,atrim=0:{d}[a]", "-map", "[v]", "-map", "[a]", "-t", str(d), *ENC, tmp])
    os.rename(tmp, out); return out
import sys
solo = sys.argv[1] if len(sys.argv) > 1 else None
card_inicio(); card_fin(); lista = [tarjeta(f"{V}/tmp/inicio.png", 4.0, "c00-inicio")]
for ci, c in enumerate(g["capitulos"], 1):
    if solo and f"{ci:02d}" != solo: continue
    card_cap(ci, c["titulo"]); lista.append(tarjeta(f"{V}/tmp/cap{ci:02d}.png", 2.4, f"c{ci:02d}"))
    for pi, p in enumerate(c["pasos"], 1): lista.append(paso(ci, pi, c["titulo"], p)); print("ok", ci, pi, flush=True)
lista.append(tarjeta(f"{V}/tmp/fin.png", 6.0, "c99-fin"))
open(f"{V}/lista.txt", "w").write("".join(f"file '{x}'\n" for x in lista))
if not solo:
    correr(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", f"{V}/lista.txt", "-c", "copy", "-movflags", "+faststart", f"{V}/Video-formativo-Regenta.mp4"])
    print("video", dur(f"{V}/Video-formativo-Regenta.mp4"))
