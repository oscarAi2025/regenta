# Banda sonora original del spot V4 de Regenta: electropop latino a 122 ppm, compuesta nota por nota en este archivo y
# tocada con instrumentos sampleados reales (SoundFont GeneralUser GS 2.0.3, licencia libre también para uso comercial).
# Estructura atada a las escenas de timeline.json. Salen stems separados (batería, percusión latina, bajo, armonía,
# melodía, efectos) para mezclarlos con la voz en mezcla.py.
import json, numpy as np, tinysoundfont as tsf
from scipy.signal import butter, sosfilt

SR = 48000
TL = json.load(open("timeline.json")); B = TL["beat"]; BAR = 4 * B; TOT = TL["total"]; N = int(TOT * SR) + SR
SF = "/tmp/claude-0/vid/sf/GeneralUser-GS.sf2"

def render(eventos, bank, prog, ganancia=1.0, cc=None):
    """eventos: [(t, nota, vel, dur)] en segundos. Devuelve audio estéreo (N, 2)."""
    s = tsf.Synth(samplerate=SR, gain=0); sf = s.sfload(SF)
    s.program_select(0, sf, bank, prog, is_drums=(bank == 128))
    if cc:
        for k, v in cc.items(): s.control_change(0, k, v)
    acts = []
    for t, n, v, d in eventos:
        acts.append((t, 1, n, v)); acts.append((t + d, 0, n, 0))
    acts.sort(key=lambda a: (a[0], a[1]))
    out = np.zeros((N, 2), np.float32); pos = 0
    for t, on, n, v in acts:
        i = min(N, int(t * SR))
        if i > pos: out[pos:i] = np.frombuffer(s.generate(i - pos), np.float32).reshape(-1, 2); pos = i
        if on: s.noteon(0, n, int(v))
        else: s.noteoff(0, n)
    if pos < N: out[pos:] = np.frombuffer(s.generate(N - pos), np.float32).reshape(-1, 2)
    return out * ganancia

beat = lambda b: b * B            # tiempo de un pulso (desde el inicio)
bar = lambda c: c * BAR
E = {k: v for k, v in TL["escenas"].items()}
BREAK, DROP = bar(12), bar(13); FINAL = bar(23); GOLPE = bar(26.5); LOGO = beat(6)

# Armonía: A – E – F#m – D (I–V–vi–IV en la mayor), un compás cada acorde
ACORDES = [[57, 61, 64, 69], [56, 59, 64, 68], [57, 61, 66, 69], [57, 62, 66, 69]]
BAJOS = [33, 40, 30, 38]
acorde = lambda c: ACORDES[int(c) % 4]; bajo = lambda c: BAJOS[int(c) % 4]

bat, lat, baj, arm, mel, fx = [], [], [], [], [], []

# ── Batería electrónica (808/909): bombo, palmas, platillos
for c in np.arange(0, 26.5, 1):
    c0 = bar(c)
    if c < 1.5 or BREAK <= c0 < DROP: continue           # sin bombo en la intro corta y en el quiebre
    lleno = c >= 4
    for b in range(4):
        t = c0 + beat(b)
        if t >= GOLPE: break
        bat.append((t, 36, 120 if lleno else 100, .2))
        if b in (1, 3) and lleno: bat.append((t, 39, 105, .15))                       # palmas en 2 y 4
        bat.append((t + B / 2, 42, 70 if b % 2 else 85, .05))                          # charles a contratiempo
        if c >= 18 and b % 2 == 1: bat.append((t + B / 2, 46, 70, .2))                 # charles abierto en la aceleración
    if lleno and int(c) % 4 == 3 and c0 + BAR <= GOLPE:                               # redoble de cierre cada 4 compases
        for k in range(4): bat.append((c0 + beat(3) + k * B / 4, 38, 70 + k * 12, .1))
# intro: golpes en el arranque y redoble hacia el logo
for t, v in ((0, 127), (beat(1.5), 90), (beat(2), 100)): bat.append((t, 36, v, .2))
for k in range(8): bat.append((beat(4) + k * B / 4, 38, 60 + k * 8, .1))
for t in (0, LOGO, bar(4), DROP, bar(18), FINAL, GOLPE): bat.append((t, 49, 120, 2.5))           # platillos de golpe
bat.append((GOLPE, 36, 127, .4))

# ── Percusión latina (kit estándar): congas en tumbao, shaker, claves, cencerro discreto
for c in np.arange(4, 26.5, 1):
    c0 = bar(c)
    if BREAK <= c0 < DROP or c0 >= GOLPE: continue
    for k, (pos, nota, v) in enumerate([(0, 63, 70), (1, 62, 60), (1.5, 64, 75), (2.5, 63, 70), (3, 62, 60), (3.5, 64, 80)]):
        lat.append((c0 + beat(pos), nota, v, .15))
    for k in range(16): lat.append((c0 + k * B / 4, 70, 45 + (12 if k % 4 == 2 else 0), .05))   # maracas en semicorcheas
    for pos in (0, 1.5, 3) if int(c) % 2 == 0 else (1, 2): lat.append((c0 + beat(pos), 75, 55, .08))  # clave 3-2
    if c >= 18: lat.append((c0 + beat(2.5), 56, 45, .1))                                 # cencerro en la aceleración

# ── Bajo sintetizado con movimiento (anticipa el acorde siguiente)
for c in np.arange(1.5, 26.5, .5 if False else 1):
    c0 = bar(c)
    if c < 2 or BREAK <= c0 < DROP or c0 >= GOLPE: continue
    r = bajo(c); sig = bajo(c + 1)
    for pos, n, d in [(0, r, .35), (.75, r + 12, .15), (1.5, r, .3), (2, r + 7, .25), (2.75, r + 12, .15), (3.5, sig, .3)]:
        baj.append((c0 + beat(pos), n, 110 if pos == 0 else 95, d))
baj.append((GOLPE, 33, 120, 1.6))

# ── Armonía: piano eléctrico a contratiempo + colchón cálido; vientos en los golpes
for c in np.arange(1.5, 26.5, 1):
    c0 = bar(c)
    if c0 >= GOLPE: continue
    ch = acorde(c)
    if not (BREAK <= c0 < DROP):
        for pos in (.5, 1.5, 2.5, 3.5) if c >= 4 else (0,):
            for n in ch: arm.append((c0 + beat(pos), n, 78, .18 if c >= 4 else 1.6))
    for n in ch[:3]: fx.append((c0, n - 12, 52, BAR * .98))                               # pad (en fx para filtrarlo aparte)
VIENTOS = []
for t in (0, LOGO, DROP, FINAL):
    for n in [57, 61, 64, 69, 73]: VIENTOS.append((t, n, 118, .5))
for n in [45, 57, 61, 64, 69, 73, 76]: VIENTOS.append((GOLPE, n, 127, 1.9))
for k, t in enumerate(np.arange(bar(24), bar(26), BAR / 2)):                               # puntadas en el final
    for n in acorde(t / BAR): VIENTOS.append((t + beat(1.5), n + 12, 105, .14))

# ── Melodía (gancho de la marca): marimba + lead de sierra suave
GANCHO = [(0, 76), (.5, 73), (1, 76), (1.5, 78), (2.5, 76), (3, 73), (3.5, 71), (4, 69), (5, 71), (5.5, 73), (6, 76), (7, 73)]
def gancho(c0, dest, vel, octava=0):
    for pos, n in GANCHO: dest.append((c0 + beat(pos), n + octava, vel, B * .45))
MAR, LEAD = [], []
gancho(LOGO, MAR, 105); gancho(LOGO, LEAD, 70)                                      # momento de lanzamiento
for c in (6, 10): gancho(bar(c), MAR, 72)                                            # recuerdos del gancho en el demo
for c in (19, 21): gancho(bar(c), MAR, 88); gancho(bar(c), LEAD, 60)
for c in (23, 25): gancho(bar(c), MAR, 110); gancho(bar(c), LEAD, 92, 0)              # final con todo

# ── Acento tecnológico (Regenta IA): arpegio de cristal en el quiebre y sobre la caída
CRIS = []
for c in np.arange(12, 18, 1):
    ch = acorde(c)
    for k in range(8 if c < 13 else 16):
        CRIS.append((bar(c) + k * (B / 2 if c < 13 else B / 4), ch[k % 4] + 12, 70 if c < 13 else 55, .2))

stems = {
    "bateria": render(bat, 128, 25, 1.0),
    "percusion": render(lat, 128, 0, .75),
    "bajo": render(baj, 0, 38, .95),
    "armonia": render(arm, 0, 4, .55),
    "pad": render(fx, 0, 89, .45),
    "vientos": render(VIENTOS, 0, 61, .6),
    "marimba": render(MAR, 0, 12, .85),
    "lead": render(LEAD, 0, 81, .35),
    "cristal": render(CRIS, 0, 98, .55),
}
for k, v in stems.items(): np.save(f"stems/{k}.npy", v)
json.dump({"golpes": [0, LOGO, bar(4), BREAK, DROP, bar(18), FINAL, GOLPE]}, open("stems/marcas.json", "w"))
print({k: round(float(np.abs(v).max()), 3) for k, v in stems.items()})
