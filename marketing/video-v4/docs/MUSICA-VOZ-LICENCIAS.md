# REGENTA V4 — Música, voz, efectos, licencias y fuentes

## Música — composición original
- Pista: «Regenta — Otro nivel», electropop latino a 122 ppm, la mayor (A–E–F#m–D). Compuesta nota por nota para este spot en `musica.py` y atada a las escenas: intro con redoble, golpe del logotipo (0:02,95), groove con tumbao de congas, maracas y clave 3-2, quiebre (0:23,6), caída de Regenta IA (0:25,6), aceleración (0:35,4), final con todo (0:45,2) y golpe de cierre (0:52,1).
- Instrumentos: muestras del banco **GeneralUser GS v2.0.3** (S. Christian Collins), tocadas con TinySoundFont.
  - Licencia del banco: «You may use GeneralUser GS without restriction for your own music creation, private or commercial» (archivo LICENSE.txt del paquete oficial). Permite uso comercial de la música creada.
  - Fuente: https://github.com/mrbumpy409/GeneralUser-GS (versión 2.0.3).
- Titularidad: la composición, el arreglo y la mezcla son originales de esta producción para IA DEV INVESTIMENTS COLOMBIA S.A.S. No se usó ninguna pista ni muestra musical de terceros con derechos reservados.
- No se usó música de biblioteca licenciada: no había ninguna cuenta de biblioteca disponible en esta sesión.

## Efectos de sonido — sintetizados
Barridos, clics, confirmación de venta (campana de dos notas), activación de la IA (arpegio + golpe), subidas e impactos: generados por código en `mezcla.py` a partir de ruido y osciladores. Sin muestras de terceros.

## Voz — limitación importante
- Voz usada: **es-CO-SalomeNeural** (voz neuronal femenina, español de Colombia), obtenida con la herramienta de código abierto `edge-tts` 7.3.1, que usa el servicio de lectura en voz alta de Microsoft Edge.
- Se compararon dos tomas completas (archivo `comparacion-voz.json`):
  - Neutra: mediana 182,6 Hz, rango 6,48 semitonos, 39,2 s.
  - Dirigida (elegida): ritmo y tono ajustados frase por frase, mediana 191,5 Hz, rango 6,6 semitonos, 37,8 s. Más brillante y ágil.
- Las únicas voces colombianas disponibles en ese servicio son Salomé (femenina) y Gonzalo (masculino); el servicio no ofrece estilos expresivos («alegre», «publicitario») para es-CO, así que la energía tiene un techo. No se fingió ni se clonó ninguna voz.
- **Licencia:** el servicio de lectura de Edge está pensado para uso personal; sus condiciones no otorgan de forma clara una licencia para publicidad pagada. Antes de pautar el spot, recomiendo regenerar la locución con una de estas vías (el guion y los tiempos están listos en `guion.json`):
  1. **Azure AI Speech** (la misma voz es-CO-SalomeNeural, con licencia comercial dentro de una suscripción de Azure). Cambio mínimo: mismos archivos, misma mezcla.
  2. **ElevenLabs** con una voz colombiana de su biblioteca y plan comercial: más expresiva.
  3. **Locutora colombiana profesional** (la opción más humana): grabar sobre `guion.json`; `mezcla.py` acepta los WAV de cada línea en `voz/`.
  Para cualquiera de las tres hace falta que Oscar abra la cuenta y pegue él mismo la clave.

## Tipografías
- Outfit (SIL Open Font License 1.1), vía @fontsource/outfit 5.1.0 — títulos y textos en pantalla.
- Barlow Semi Condensed Bold (SIL OFL 1.1) — subtítulos integrados.

## Imágenes
- Todas las pantallas son grabaciones reales de la plataforma Regenta en su cuenta demo (datos ficticios), hechas con Playwright sobre la versión actual del código. Logotipo de Regenta tomado del propio producto.
