import json, html, os
from PIL import Image
G = "/tmp/claude-0/-home-claude/cc809211-d237-5d8a-8dcb-ec68bc3fe822/scratchpad/guia"
FS = "/home/claude/rg3-int/node_modules/@fontsource"
g = json.load(open(f"{G}/guion.json"))
os.makedirs(f"{G}/pdf/img", exist_ok=True)
CON_MENU = {"02-inicio", "03-menu", "04-buscador", "05-ia"}
CENTRO = {"00a-activar", "00b-activar-lleno", "00c-activada"}
def recorte(im, nombre):
    w, h = im.size; s = w / 1920
    if nombre in CENTRO: return im.crop((int(600*s), int(120*s), int(1320*s), int(900*s)))
    if nombre in {"01-entrar", "01b-olvide", "52-celular", "23c-factura-carta", "23d-tirilla"}:
        if nombre == "23c-factura-carta": return im.crop((int(560*s), int(70*s), int(1360*s), int(680*s)))
        return im
    x0 = 0 if nombre in CON_MENU else int(236*s)
    im = im.crop((x0, 0, w, h))
    # Quita el fondo vacío de abajo (filas del mismo color que la esquina inferior derecha).
    px = im.convert("RGB").load(); W, H = im.size; ref = px[W-40, H-5]
    def igual(c): return all(abs(c[i]-ref[i]) < 6 for i in range(3))
    y = H - 1
    while y > H * 0.45 and all(igual(px[x, y]) for x in range(0, W, max(1, W//160))): y -= 1
    return im.crop((0, 0, W, min(H, y + int(24*s))))
def img(nombre):
    src = f"{G}/pasos/{nombre}.png"; dst = f"{G}/pdf/img/{nombre}.jpg"
    im = recorte(Image.open(src).convert("RGB"), nombre)
    if im.width > 2600: im = im.resize((2600, round(im.height * 2600 / im.width)), Image.LANCZOS)
    im.save(dst, quality=88); return dst
LOGO = open("/home/claude/rg3-int/src/app/icon.svg").read()
def para(t):
    out = []
    for linea in t.split("\n"):
        e = html.escape(linea)
        if linea[:2] in [f"{i}." for i in range(1, 10)]: out.append(f'<p class="num"><b>{e[:2]}</b>{e[2:]}</p>')
        else: out.append(f"<p>{e}</p>")
    return "".join(out)
cap_html, indice = [], []
for n, c in enumerate(g["capitulos"], 1):
    indice.append(f'<li><span class="n">{n:02d}</span><span class="t">{html.escape(c["titulo"])}</span></li>')
    pasos = []
    for i, p in enumerate(c["pasos"], 1):
        clase = " movil" if p["img"] == "52-celular" else " angosto" if p["img"] in CENTRO or p["img"] == "23c-factura-carta" else ""
        pasos.append(f'''<figure class="paso{clase}"><div class="marco"><img src="file://{img(p["img"])}"></div>
          <figcaption><span class="badge">{n}.{i}</span><div>{para(p["texto"])}</div></figcaption></figure>''')
    cap_html.append(f'''<section class="cap"><header><span class="kicker">Capítulo {n:02d}</span><h2>{html.escape(c["titulo"])}</h2><p class="intro">{html.escape(c["intro"])}</p></header>{''.join(pasos)}</section>''')
atajos = [("F2", "Ir a la casilla de búsqueda de la caja"), ("12*", "Antes de escanear: lleva 12 unidades"), ("↑ ↓ y Enter", "Elegir un resultado y agregar la caja"),
          ("F4", "Poner la venta en espera"), ("F6", "Recuperar una venta en espera"), ("F9", "Cobrar"), ("Enter", "Después de cobrar: nueva venta"), ("Esc", "Volver a la venta"), ("Ctrl + K", "Buscar o preguntar en todo Regenta")]
roles = [("Dueño", "Todo, incluida «Mi droguería»: datos de la droguería, equipo, cajas, formato de factura, logo y plan."),
         ("Administrador", "Todo, menos «Mi droguería»."),
         ("Cajera/o", "Inicio, Caja, Pedidos, Turno, Ventas, Productos, Inventario y Alertas. No ve costos ni márgenes."),
         ("Bodega", "Inicio, Productos, Etiquetas, Inventario, Cuarentena, Predicción, Alertas, Compras y Temperatura."),
         ("Vendedor", "Inicio y Pedidos: cotizaciones y domicilios.")]
HTML = f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Guía de usuario de Regenta</title><style>
@font-face{{font-family:Barlow;font-weight:400;src:url(file://{FS}/barlow/files/barlow-latin-400-normal.woff2)}}
@font-face{{font-family:Barlow;font-weight:500;src:url(file://{FS}/barlow/files/barlow-latin-500-normal.woff2)}}
@font-face{{font-family:Barlow;font-weight:600;src:url(file://{FS}/barlow/files/barlow-latin-600-normal.woff2)}}
@font-face{{font-family:Barlow;font-weight:700;src:url(file://{FS}/barlow/files/barlow-latin-700-normal.woff2)}}
@font-face{{font-family:BarlowC;font-weight:700;src:url(file://{FS}/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2)}}
@font-face{{font-family:BarlowC;font-weight:600;src:url(file://{FS}/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2)}}
:root{{--ink:#10233a;--teal:#0f766e;--teal2:#14b8a6;--muted:#55676f;--line:#d9e2e1;--paper:#eef3f2;--amber:#f59e0b}}
@page{{size:A4;margin:16mm 15mm 18mm}}
@page:first{{margin:0}}
*{{box-sizing:border-box}} body{{font-family:Barlow,sans-serif;color:var(--ink);font-size:10.5pt;line-height:1.5;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
h1,h2,h3{{font-family:BarlowC,sans-serif;font-weight:700;letter-spacing:-.01em;margin:0}}
.portada{{height:297mm;width:210mm;background:var(--ink);color:#fff;padding:24mm 20mm;display:flex;flex-direction:column;page-break-after:always;position:relative;overflow:hidden}}
.portada .marca{{display:flex;gap:12px;align-items:center}} .portada .marca svg{{width:52px;height:52px}}
.portada .marca b{{font-family:BarlowC;font-size:30pt;display:block;line-height:1}} .portada .marca small{{color:#5eead4;font-weight:600;font-size:10pt}}
.portada h1{{font-size:46pt;line-height:.98;margin-top:52mm}} .portada .sub{{font-size:15pt;color:#cbd5e1;margin-top:8mm;max-width:150mm}}
.portada .pie{{margin-top:auto;display:flex;justify-content:space-between;color:#94a3b8;font-size:9.5pt;border-top:1px solid rgba(255,255,255,.18);padding-top:5mm}}
.portada .franja{{position:absolute;right:-30mm;top:95mm;width:120mm;height:120mm;border-radius:28mm;background:linear-gradient(135deg,#14b8a6,#0e7490 55%,#1d4ed8);opacity:.22;transform:rotate(18deg)}}
.indice{{page-break-after:always}} .indice h2{{font-size:26pt;margin-bottom:5mm}}
.indice ol{{list-style:none;padding:0;margin:0;columns:1}} .indice li{{display:flex;gap:6mm;padding:1.25mm 0;border-bottom:1px solid var(--line);font-size:12.5pt}}
.indice .n{{font-family:BarlowC;font-weight:700;color:var(--teal);width:10mm}}
.antes{{break-inside:avoid;margin-top:5mm;background:var(--paper);border-radius:4mm;padding:6mm 7mm}} .antes h3{{font-size:14pt;margin-bottom:2mm}} .antes ul{{margin:0;padding-left:5mm}}
.cap{{page-break-before:always}} .cap header{{border-left:2.2mm solid var(--teal2);padding:1mm 0 1mm 6mm;margin-bottom:7mm}}
.kicker{{font-weight:600;color:var(--teal);font-size:10pt}} .cap h2{{font-size:26pt;line-height:1.05;margin:1mm 0 2.5mm}} .intro{{margin:0;color:#334155;font-size:11pt;max-width:165mm}}
.paso{{margin:0 0 7mm;break-inside:avoid}} .marco{{border:1px solid var(--line);border-radius:3mm;overflow:hidden;box-shadow:0 1.5mm 4mm rgba(16,35,58,.10);width:fit-content;max-width:100%;margin:0 auto}} .marco img{{display:block;max-width:100%;max-height:96mm}}
.paso.movil .marco{{width:62mm;margin:0 auto}} .paso.angosto .marco{{width:120mm;margin:0 auto}}
figcaption{{display:flex;gap:4mm;margin-top:3.5mm;align-items:flex-start}} figcaption p{{margin:0 0 1.6mm}}
.badge{{flex:none;font-family:BarlowC;font-weight:700;background:var(--ink);color:#fff;border-radius:2mm;padding:.6mm 2.2mm;font-size:10pt;margin-top:.4mm}}
.tabla{{width:100%;border-collapse:collapse;margin-top:4mm}} .tabla td{{border-bottom:1px solid var(--line);padding:2.6mm 2mm;vertical-align:top}}
.tabla td:first-child{{font-weight:700;white-space:nowrap;width:38mm}} kbd{{font-family:BarlowC;font-weight:600;border:1px solid #94a3b8;border-bottom-width:2px;border-radius:1.4mm;padding:.2mm 1.8mm;background:#fff}}
.cierre{{page-break-before:always}} .cierre h2{{font-size:24pt;margin-bottom:3mm}}
.contacto{{margin-top:10mm;background:var(--ink);color:#fff;border-radius:4mm;padding:8mm}} .contacto b{{color:#5eead4}}
</style></head><body>
<section class="portada"><div class="franja"></div><div class="marca">{LOGO}<div><b>Regenta</b><small>Facturación e IA para el sector farmacéutico</small></div></div>
<h1>Guía de usuario</h1><p class="sub">Tu primer acceso y el uso de Regenta paso a paso, pestaña por pestaña: caja, factura electrónica, inventario por lote, cartera, cumplimiento y reportes.</p>
<div class="pie"><span>regenta.pro · by Farmagenéricos Colombia</span><span>Versión de noviembre de 2026</span></div></section>
<section class="indice"><h2>Contenido</h2><ol>{''.join(indice)}<li><span class="n">✓</span><span class="t">Atajos de teclado y roles</span></li></ol>
<div class="antes"><h3>Antes de empezar</h3><ul><li>Un computador, tableta o celular con internet y un navegador actualizado (Chrome, Edge, Safari o Firefox).</li>
<li>El correo con el que contrataste Regenta: ahí llega tu enlace para crear la contraseña.</li><li>Opcional: lector de código de barras, impresora térmica de tirilla (80 o 58 mm) e impresora para tamaño carta.</li>
<li>Las imágenes de esta guía son de una droguería de ejemplo, «Droguería San Rafael»; tus pantallas mostrarán tus datos.</li></ul></div></section>
{''.join(cap_html)}
<section class="cierre"><h2>Atajos de teclado de la caja</h2><table class="tabla">{''.join(f'<tr><td><kbd>{html.escape(k)}</kbd></td><td>{html.escape(v)}</td></tr>' for k, v in atajos)}</table>
<h2 style="margin-top:10mm">Qué ve cada rol</h2><table class="tabla">{''.join(f'<tr><td>{html.escape(k)}</td><td>{html.escape(v)}</td></tr>' for k, v in roles)}</table>
<div class="contacto"><h3 style="font-size:16pt;margin-bottom:2mm">¿Necesitas ayuda?</h3>Pregúntale a <b>Regenta IA</b> dentro del programa, o escríbenos por WhatsApp al <b>+57 321 214 1970</b> o al correo <b>gerencia@farmagenericoscolombia.com</b>. Te acompañamos en tu primera venta.</div></section>
</body></html>'''
open(f"{G}/pdf/guia.html", "w").write(HTML)
print("ok")
