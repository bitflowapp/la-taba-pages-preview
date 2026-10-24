// Página de mantenimiento: este service worker RETIRA el de la tienda anterior.
//
// Los teléfonos que ya visitaron la-taba.pages.dev tienen instalado el worker de la v144, que guarda la tienda en
// caché. El navegador revisa `/sw.js` al navegar; al encontrar este, lo instala, borra todas las cachés del sitio,
// se da de baja y recarga las pestañas abiertas: la próxima carga viene de la red, o sea, esta página.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
