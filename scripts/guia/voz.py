import json, subprocess, os
G = "/tmp/claude-0/-home-claude/cc809211-d237-5d8a-8dcb-ec68bc3fe822/scratchpad/guia"
g = json.load(open(f"{G}/guion.json"))
n = 0
for ci, c in enumerate(g["capitulos"], 1):
    for pi, p in enumerate(c["pasos"], 1):
        f = f"{G}/video/voz/{ci:02d}-{pi:02d}.mp3"
        if os.path.exists(f) and os.path.getsize(f) > 1000: continue
        for intento in range(3):
            r = subprocess.run(["edge-tts", "--proxy", os.environ["HTTPS_PROXY"], "--voice", "es-CO-SalomeNeural", "--rate=+12%", "--pitch=+8Hz", "--text", p["voz"], "--write-media", f], capture_output=True, text=True, timeout=90)
            if r.returncode == 0 and os.path.getsize(f) > 1000: break
        n += 1
print("generados", n)
