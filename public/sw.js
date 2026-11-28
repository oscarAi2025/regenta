// Regenta · service worker mínimo (28/11/2026): la web se puede instalar y, sin conexión, enseña una página propia en
// vez del error del navegador. No guarda en caché la consola ni la API: los datos siempre vienen del servidor.
const CACHE = "regenta-v1";
const SIN_CONEXION = "/sin-conexion.html";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SIN_CONEXION, "/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(SIN_CONEXION)));
});
