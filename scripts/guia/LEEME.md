# Guía de usuario y video formativo de Regenta

Se regeneran cuando cambian las pantallas:

1. `recaptura.sh` — reinicia la base local, captura cada paso (1920×1080 @2x, locale es-CO) con `capturas.mjs`.
2. `guion.json` — textos de la guía (`texto`) y narración del video (`voz`), por capítulo y paso.
3. `armar_pdf.py` + `pdf.mjs` — arma `guia.html` y lo imprime a PDF A4.
4. `voz.py` — narración con la voz neural es-CO «Salomé» (edge-tts, con el proxy).
5. `armar_video.py` — un clip por paso (zoom al control resaltado, subtítulos, rótulo del capítulo), tarjetas y concat.

Las rutas de trabajo apuntan a la carpeta temporal de la sesión: ajústalas antes de correrlos.
