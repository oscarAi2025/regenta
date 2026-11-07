# Spot de lanzamiento V4 — proyecto editable

Cadena reproducible (los vídeos v1–v3 no se tocan; los MP4 no se versionan aquí por peso).

1. `grabar-tomas.mjs` — graba la plataforma real (demo local en :4550) con Playwright → fotogramas `fr/<toma>/NNNN.jpg`.
2. `voz.py voz` — locución es-CO por frases (guion.json) + marcas de palabra (`palabras.json` va en `voz/`).
3. `musica.py` — banda sonora original (GeneralUser GS) en stems atados a `timeline.json`.
4. `web/film.html?f=h|v|c` — composición y animación (16:9, 9:16, 1:1); `node cuadros.mjs` saca fotogramas de control y `sfx.json`.
5. `bash renderizar.sh h v c` — render a MP4 30 fps.
6. `mezcla.py` — mezcla, efectos sintetizados, ducking y loudnorm (-14 LUFS / -1 dBTP); también el audio del teaser.
7. `subtitulos.py` — `.srt` y `subs.ass` (palabras clave en turquesa) para la versión subtitulada.

Documentación: `docs/GUION-V4.md`, `docs/MUSICA-VOZ-LICENCIAS.md`, `docs/QA-V4.md`.
