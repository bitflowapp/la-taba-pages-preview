# Precheck final de staging para smoke GPS

- Moto G15 autorizado: exactamente uno, serial `ZY32LHS6PS`, modelo `moto_g15`, estado ADB `device`.
- Git: rama `release/taba2-rider-production-rc1`; HEAD `214d2b49eff7bb78e4459161a381f646ddf2034b`; status limpio; `git diff --check` limpio.
- Business remoto: sólo `la-taba-staging`, ref `ukxqbgswjlibmnjemrzd`.
- Pedidos activos del business: cero.
- Rider QA elegido: identidad preexistente sintética autorizada `d1c72b84-1ab5-4a0a-989f-80f6843b609f`.
- Membership: activa, rol `rider`, business correcto.
- Entrega activa del Rider elegido: cero según `get_active_rider_delivery()`.
- GPS activo: cero; no hay proceso TABA ni foreground service en el Moto G15.
- Locks operativos: cero.
- Outbox QA pendiente: cero.
- Producción: no consultada ni modificada; no se usaron credenciales, endpoints, deploys ni APK de producción.
- APK: no instalado en esta preparación.
- Pedido nuevo: no creado.

Resultado: staging está preparado para crear el pedido QA, pero el smoke todavía no comenzó. El siguiente paso autorizado puede crear el pedido QA y guiar el smoke de a un paso.
