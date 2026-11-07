# REGENTA V4 — Registro de comprobaciones técnicas

Fecha: 07/11/2026 07:32 · ffmpeg 6.1.1-3ubuntu5

## REGENTA-LANZAMIENTO-V4-16x9-SUB.mp4
```
codec_name=h264
profile=High
width=1920
height=1080
pix_fmt=yuv420p
r_frame_rate=30/1
nb_frames=1620
codec_name=aac
profile=LC
sample_rate=48000
channels=2
r_frame_rate=0/0
nb_frames=2533
duration=54.000000
bit_rate=2942589
I:         -14.1 LUFS
LRA:         3.6 LU
Peak:       -1.3 dBFS
errores de decodificación completa: 0
tramos negros (≥0,2 s): 0
silencios (≥0,5 s a -45 dB): 0
```
## REGENTA-LANZAMIENTO-V4-16x9.mp4
```
codec_name=h264
profile=High
width=1920
height=1080
pix_fmt=yuv420p
r_frame_rate=30/1
nb_frames=1620
codec_name=aac
profile=LC
sample_rate=48000
channels=2
r_frame_rate=0/0
nb_frames=2533
duration=54.000000
bit_rate=3646821
I:         -14.1 LUFS
LRA:         3.6 LU
Peak:       -1.3 dBFS
errores de decodificación completa: 0
tramos negros (≥0,2 s): 0
silencios (≥0,5 s a -45 dB): 0
```
## REGENTA-LANZAMIENTO-V4-1x1.mp4
```
codec_name=h264
profile=High
width=1080
height=1080
pix_fmt=yuv420p
r_frame_rate=30/1
nb_frames=1620
codec_name=aac
profile=LC
sample_rate=48000
channels=2
r_frame_rate=0/0
nb_frames=2533
duration=54.000000
bit_rate=2604519
I:         -14.1 LUFS
LRA:         3.6 LU
Peak:       -1.3 dBFS
errores de decodificación completa: 0
tramos negros (≥0,2 s): 0
silencios (≥0,5 s a -45 dB): 0
```
## REGENTA-LANZAMIENTO-V4-9x16.mp4
```
codec_name=h264
profile=High
width=1080
height=1920
pix_fmt=yuv420p
r_frame_rate=30/1
nb_frames=1620
codec_name=aac
profile=LC
sample_rate=48000
channels=2
r_frame_rate=0/0
nb_frames=2533
duration=54.000000
bit_rate=3410970
I:         -14.1 LUFS
LRA:         3.6 LU
Peak:       -1.3 dBFS
errores de decodificación completa: 0
tramos negros (≥0,2 s): 0
silencios (≥0,5 s a -45 dB): 0
```
## REGENTA-TEASER-15S.mp4
```
codec_name=h264
profile=High
width=1080
height=1920
pix_fmt=yuv420p
r_frame_rate=30/1
nb_frames=555
codec_name=aac
profile=LC
sample_rate=48000
channels=2
r_frame_rate=0/0
nb_frames=873
duration=18.590000
bit_rate=3178146
I:         -14.1 LUFS
LRA:         2.1 LU
Peak:       -1.3 dBFS
errores de decodificación completa: 0
tramos negros (≥0,2 s): 0
silencios (≥0,5 s a -45 dB): 0
```

## Revisión visual (fotogramas extraídos y revisados uno a uno)
- 16:9: 32 fotogramas de 0:00,5 a 0:53,9. Sin pantallas negras, textos completos, capturas legibles (zoom 1,5–2× sobre la zona útil), logotipo correcto, dominio «regenta.pro» correcto, CTA legible.
- 9:16: 12 fotogramas. Composición propia: títulos arriba (desde y=230, fuera de la franja de la app), pantalla alta con zoom, chips de la IA y nota legal por encima de la zona inferior de interfaz de Reels/TikTok.
- 1:1: 12 fotogramas. Composición propia (pantalla 960×700, rótulos a la izquierda en la escena de la IA).
- Teaser 9:16 (18,6 s): gancho → ¡Llegó Regenta! → venta registrada → Regenta IA → cierre con CTA. Cortes en el pulso de la música (122 ppm).
- Subtítulos integrados (16:9-SUB): máximo dos líneas, caja azul semitransparente, palabras clave en turquesa; la del CTA en una sola línea para no tapar «Demo gratis, sin registro»; no tapan la nota legal de la DIAN.

## Audio
- Música continua de 0:00 a 0:54 (sin silencios ≥0,5 s). Ducking de -6 dB máx. bajo la voz; la música nunca desaparece.
- Objetivo -14 LUFS integrados y pico verdadero ≤ -1 dBTP: cumplido en los cinco archivos (medido arriba con ebur128 tras la codificación AAC).
- Subtítulos contra la voz: tiempos de inicio tomados de las marcas de palabra de la locución (palabras.json), no estimados.

## Ortografía y afirmaciones
- Textos en pantalla revisados: «¡Tu droguería puede estar en otro nivel!», «Ventas ágiles», «POS + factura electrónica», «Controla cada lote», «Anticípate a los vencimientos», «Regenta IA», «Inteligencia para decidir mejor», «Menos enredos. Más control. ¡Más tiempo para crecer!», «Tu droguería, en orden.», «¡Pruébala gratis!», «regenta.pro», «Demo gratis, sin registro».
- No aparecen precios, garantías, certificaciones, «único en Colombia» ni competidores. La emisión DIAN se muestra como simulada, con nota legal.

## Pendiente conocido
- La locución sale del servicio de lectura de Edge: regenerarla con licencia comercial (Azure AI Speech, ElevenLabs o locutora) antes de pautar. Ver MUSICA-VOZ-LICENCIAS.md.
