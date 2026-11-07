#!/bin/bash
# Renderiza los tres formatos en tramos paralelos y los une sin recodificar.  Uso: bash renderizar.sh [h v c]
cd "$(dirname "$0")"; set -e
for f in ${@:-h v c}; do
  node render.mjs $f seg/$f-1.mp4 0 27 & node render.mjs $f seg/$f-2.mp4 27 54 & wait
  printf "file '%s'\n" $f-1.mp4 $f-2.mp4 > seg/$f.txt
  ffmpeg -v error -y -f concat -safe 0 -i seg/$f.txt -c copy seg/mudo-$f.mp4 && echo "listo $f"
done
