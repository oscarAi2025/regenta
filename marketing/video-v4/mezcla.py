# Mezcla del spot V4: stems de la banda sonora original + locución + efectos sintetizados (todo original, sin muestras de terceros).
# Música con compresión lateral desde el bombo, reverberación en envío, voz con ecualización y compresión,
# ducking de la música bajo la voz (baja ~6 dB, nunca desaparece) y normalización en dos pasadas a -14 LUFS / -1 dBTP.
# Uso: python3 mezcla.py            → mezcla/principal.wav (54 s) y mezcla/teaser.wav
import json, subprocess, numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly, fftconvolve

SR = 48000
TL = json.load(open("timeline.json")); TOT = TL["total"]; N = int(TOT * SR)
SFX = json.load(open("sfx.json")); MAR = json.load(open("stems/marcas.json"))["golpes"]
rng = np.random.default_rng(7)
bp = lambda lo, hi, x: sosfilt(butter(2, [lo, hi], "band", fs=SR, output="sos"), x, axis=0)
hp = lambda f, x, o=2: sosfilt(butter(o, f, "high", fs=SR, output="sos"), x, axis=0)
lp = lambda f, x, o=2: sosfilt(butter(o, f, "low", fs=SR, output="sos"), x, axis=0)
db = lambda d: 10 ** (d / 20)

def env(x, at, rel):
    """seguidor de envolvente (mono) con ataque/liberación en segundos"""
    a, r = np.exp(-1 / (at * SR)), np.exp(-1 / (rel * SR)); y = np.empty_like(x); v = 0.0
    for i, s in enumerate(x):
        c = a if s > v else r; v = c * v + (1 - c) * s; y[i] = v
    return y

def suavizar(g, ms):
    k = int(SR * ms / 1000); return np.convolve(g, np.ones(k) / k, "same")

# ── música
st = {k: np.load(f"stems/{k}.npy")[:N] for k in ["bateria", "percusion", "bajo", "armonia", "pad", "vientos", "marimba", "lead", "cristal"]}
G = {"bateria": 0, "percusion": -3, "bajo": -1.5, "armonia": -4, "pad": -6, "vientos": -3, "marimba": -2, "lead": -6, "cristal": -4}
for k in st: st[k] = st[k] * db(G[k])
# compresión lateral: el bombo (graves de la batería) empuja bajo, pad y armonía
kick = env(np.abs(lp(140, st["bateria"].mean(1), 4)), .002, .12); kick /= kick.max() + 1e-9
sc = suavizar(1 - .55 * np.clip(kick * 1.6, 0, 1), 4)[:, None]
for k in ("bajo", "pad", "armonia"): st[k] *= sc
# reverberación por envío (respuesta al impulso sintética, estéreo decorrelada, 1,4 s)
L = int(1.4 * SR); dec = np.exp(-np.linspace(0, 6.5, L))
ir = np.stack([rng.standard_normal(L) * dec, rng.standard_normal(L) * dec], 1); ir = lp(7000, ir); ir /= np.abs(ir).sum(0) ** .5 * 6
envio = sum(st[k] * g for k, g in [("armonia", .35), ("pad", .4), ("marimba", .3), ("lead", .35), ("cristal", .5), ("vientos", .25)])
rev = np.stack([fftconvolve(envio[:, c], ir[:, c])[:N] for c in range(2)], 1)
musica = sum(st.values()) + hp(200, rev) * .55
musica = hp(28, musica, 4)

# ── voz: 24 kHz → 48 kHz, paso alto, presencia, compresión suave
def voz_linea(k):
    d, sr = sf.read(f"voz/{k}.wav"); d = resample_poly(d, SR, sr)
    d = hp(85, d, 3); d = d + .35 * bp(2500, 5500, d) + .15 * bp(180, 320, d)       # presencia y algo de cuerpo
    e = env(np.abs(d), .005, .08); thr = .12; g = np.where(e > thr, (thr + (e - thr) / 3) / (e + 1e-9), 1)  # 3:1
    return d * suavizar(g, 3)

def pista_voz(activas=None, recortes=None):
    v = np.zeros(N)
    for l in TL["lineas"]:
        if activas and l["k"] not in activas: continue
        d = voz_linea(l["k"])
        if recortes and l["k"] in recortes:
            n = int(recortes[l["k"]] * SR); d = d[:n] * np.r_[np.ones(max(0, n - 1200)), np.linspace(1, 0, min(n, 1200))]
        i = int(l["ini"] * SR); v[i:i + len(d)] += d[:N - i]
    return v

# ── efectos sintetizados
def ruido(n): return rng.standard_normal(n)
def adsr(n, at, de): t = np.arange(n) / SR; return np.minimum(1, t / max(at, 1e-4)) * np.exp(-np.maximum(0, t - at) / de)
def tono(f0, f1, dur, de, arm=(1,)):
    n = int(dur * SR); f = np.geomspace(f0, f1, n); ph = 2 * np.pi * np.cumsum(f) / SR
    return sum(np.sin(ph * (i + 1)) * a for i, a in enumerate(arm)) * adsr(n, .003, de)
def whoosh(dur=.55):
    n = int(dur * SR); t = np.linspace(0, 1, n); x = ruido(n)
    claro, oscuro = bp(1500, 9000, x), bp(300, 1500, x); k = np.sin(np.pi * t) ** 2       # el brillo sube y vuelve
    o = (oscuro * (1 - k) + claro * k) * np.sin(np.pi * t) ** 1.5 * .8
    return np.stack([o * (1 - t * .7), o * (.3 + t * .7)], 1)
def impacto(g=1):
    n = int(1.3 * SR); sub = tono(95, 38, 1.3, .35); r = lp(1800, ruido(n)) * adsr(n, .001, .09) * .5
    m = (sub * .9 + r) * g; return np.stack([m, m], 1)
def pop(): m = tono(700, 1300, .12, .035, (1, .3)) * .6; return np.stack([m, m], 1)
def clic(): n = int(.03 * SR); m = hp(2500, ruido(n)) * adsr(n, .0005, .004) * .5 + tono(3200, 3000, .03, .006) * .2; return np.stack([m, m], 1)
def campana(f, dur=1.2): return tono(f, f, dur, .35, (1, .25, .1, .05))
def venta():
    a = campana(1318.5); b = campana(1975.5); n = len(a) + int(.11 * SR); m = np.zeros(n)
    m[:len(a)] += a * .55; m[int(.11 * SR):] += b * .5; return np.stack([m * .95, m], 1)
def ia():
    n = int(1.6 * SR); m = np.zeros(n)
    for i, f in enumerate([880, 1108.7, 1318.5, 1760, 2217.5]):                       # arpegio brillante ascendente
        a = campana(f, 1.0) * .3; j = int(i * .045 * SR); m[j:j + len(a)] += a[:n - j]
    im = impacto(.8)[:, 0]; m[:len(im)] += im * .9; s = hp(5000, ruido(n)) * adsr(n, .01, .3) * .12
    return np.stack([m + s, m - s * .5], 1)
def subida(dur):
    n = int(dur * SR); t = np.linspace(0, 1, n); x = ruido(n)
    o = (bp(300, 1200, x) * (1 - t) + bp(2000, 12000, x) * t) * t ** 2 * .9; return np.stack([o, o], 1)
def final(): a = impacto(1.2); v = venta(); m = np.zeros((max(len(a), len(v)), 2)); m[:len(a)] += a; m[:len(v)] += v * .8; return m

GEN = {"whoosh": whoosh, "impacto": impacto, "pop": pop, "clic": clic, "venta": venta, "ia": ia, "final": final}
def pista_sfx():
    x = np.zeros((N, 2))
    for e in SFX:
        s = subida(min(m for m in MAR if m > e["t"] + .3) - e["t"]) if e["k"] == "subida" else GEN[e["k"]]()
        i = int(e["t"] * SR); n = min(len(s), N - i); x[i:i + n] += s[:n] * e["g"]
    return x * db(-9)

def master(voz, efectos, nombre):
    v = np.stack([voz, voz], 1) * db(2)
    duck = env(np.abs(voz), .03, .35); duck = duck / (duck.max() + 1e-9)
    gm = db(-6) ** np.clip(duck * 6, 0, 1)                                           # hasta -6 dB bajo la voz
    m = musica * suavizar(gm, 20)[:, None] * db(-3) + v + efectos
    m[-int(.4 * SR):] *= np.linspace(1, 0, int(.4 * SR))[:, None] ** 2                 # salida limpia del último golpe
    pico = np.abs(m).max(); m = m / pico * .8
    sf.write(f"mezcla/{nombre}-pre.wav", m.astype(np.float32), SR, subtype="FLOAT")
    return m

def normalizar(nombre):
    """loudnorm en dos pasadas (medición + lineal) a -14 LUFS integrados, -1 dBTP"""
    a = f"mezcla/{nombre}-pre.wav"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", a, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
    j = json.loads(r[r.rindex("{"):r.rindex("}") + 1])
    f = f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a, "-af", f + ",aresample=48000", "-c:a", "pcm_s24le", f"mezcla/{nombre}.wav"], check=True)

if __name__ == "__main__":
    import os; os.makedirs("mezcla", exist_ok=True)
    fx = pista_sfx()
    master(pista_voz(), fx, "principal"); normalizar("principal")
    # teaser 15–20 s: gancho + logo, venta registrada, caída de Regenta IA, cierre con CTA (cortes en el pulso)
    BAR = 4 * TL["beat"]; TRAMOS = [(0, 2.5 * BAR), (6.5 * BAR, 7.5 * BAR), (13 * BAR, 14.5 * BAR), (23 * BAR, TOT)]
    m = master(pista_voz({"01", "02", "06", "10", "11"}, {"02": 1.15}), fx, "teaser-largo")
    xf = int(.012 * SR); out = []
    for a, b in TRAMOS:
        s = m[int(a * SR):int(b * SR)].copy(); s[:xf] *= np.linspace(0, 1, xf)[:, None]; s[-xf:] *= np.linspace(1, 0, xf)[:, None]; out.append(s)
    t = np.concatenate(out); sf.write("mezcla/teaser-pre.wav", (t / np.abs(t).max() * .8).astype(np.float32), SR, subtype="FLOAT"); normalizar("teaser")
    json.dump(TRAMOS, open("mezcla/tramos-teaser.json", "w")); print("listo", [round(b - a, 3) for a, b in TRAMOS], round(sum(b - a for a, b in TRAMOS), 2))
