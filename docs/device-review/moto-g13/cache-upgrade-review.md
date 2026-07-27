# Actualización en sesión normal

## Reproducción

Se partió de una sesión normal de Chrome que conservaba una versión anterior del catálogo publicado. No se usó incógnito ni se eliminaron datos generales de Chrome.

## Resultado

- El service worker versionado detectó la versión nueva y mostró el aviso simple `Hay una actualización disponible`.
- Al elegir `Actualizar ahora`, Chrome recibió la versión actual sin intervención técnica adicional.
- Los pedidos y el carrito sandbox compatibles se conservaron; la actualización de catálogo base no descartó estado operativo.
- El service worker usa caché versionada y estrategia de red primero para evitar que el catálogo publicado quede fijado en una revisión vieja.
- La entrada de la aplicación se versiona junto con el worker; un script pequeño e independiente registra y observa la actualización antes del módulo de la aplicación, por lo que una pestaña móvil no queda retenida por el bootstrap ni IndexedDB.
- Si el worker termina de instalar entre el registro y el listener, la aplicación vuelve a comprobarlo y muestra el aviso de actualización pendiente.
- El registro usa `updateViaCache: 'none'`, observa el worker instalándose, sigue comprobándolo durante su precache y vuelve a hacerlo al regresar al primer plano; así una sesión normal no reutiliza un `sw.js` HTTP antiguo ni pierde el aviso de actualización.
- El aviso automático de instalación PWA se eliminó del primer recorrido para no competir con la compra.

La cobertura automatizada incluye actualización desde estado anterior y conservación del estado compatible.
