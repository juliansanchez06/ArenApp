// El Retiro – Service Worker RETIRADO (autolimpiante, sin intermediación)
// No tiene handler de 'fetch', así que NUNCA toca las conexiones (ni las de Firebase).
// Lo único que hace es limpiar los caches viejos y desinstalarse. Es inofensivo
// aunque el index.html lo vuelva a registrar: como no intercepta nada, no molesta.
self.addEventListener('install', () => self.skipWaiting());
 
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();        // toma el control y reemplaza al SW viejo
      await self.registration.unregister(); // y se da de baja
    } catch (err) {
      // si algo falla, no bloqueamos nada
    }
  })());
});
 
