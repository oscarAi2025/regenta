import json, asyncio, os, ssl, subprocess, numpy as np
import edge_tts, edge_tts.communicate as ec
ec._SSL_CTX = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
P = os.environ.get("HTTPS_PROXY"); SR = 24000; import sys; DIR = sys.argv[1]; NEUTRA = len(sys.argv) > 2
g = json.load(open('guion.json')); palabras = {}
def pcm(b):
    open('/tmp/_f.mp3', 'wb').write(b)
    return np.frombuffer(subprocess.check_output(["ffmpeg", "-v", "error", "-i", "/tmp/_f.mp3", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]), np.int16).astype(np.float32)
def recortar(x, umbral=250):
    idx = np.where(np.abs(x) > umbral)[0]
    if not len(idx): return x, 0
    a = max(0, idx[0] - int(.03 * SR)); b = min(len(x), idx[-1] + int(.06 * SR)); return x[a:b], a / SR
async def go():
    for k, frases in g:
        out = np.zeros(0, np.float32); ws = []
        for txt, rate, pitch, pausa in frases:
            c = edge_tts.Communicate(txt, "es-CO-SalomeNeural", rate=("+0%" if NEUTRA else rate), pitch=("+0Hz" if NEUTRA else pitch), proxy=P, boundary="WordBoundary")
            audio = bytearray(); w = []
            async for m in c.stream():
                if m["type"] == "audio": audio += m["data"]
                elif m["type"] == "WordBoundary": w.append([m["offset"] / 1e7, m["text"]])
            x, corte = recortar(pcm(bytes(audio)))
            base = len(out) / SR
            ws += [[round(base + o - corte, 3), t] for o, t in w]
            out = np.concatenate([out, x, np.zeros(int(pausa * SR), np.float32)])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", f"{DIR}/{k}.wav"], input=out.astype(np.int16).tobytes(), check=True)
        palabras[k] = ws; print(k, round(len(out) / SR, 2))
asyncio.run(go()); json.dump(palabras, open(DIR + '/palabras.json', 'w'), ensure_ascii=False)
