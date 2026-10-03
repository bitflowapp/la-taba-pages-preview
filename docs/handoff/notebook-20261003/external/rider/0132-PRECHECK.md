# Precheck

## Estado final de preparación

- Fuente Android Rider: `D:\1212\la-taba-rider-production-rc1`
- Rama: `release/taba2-rider-production-rc1`
- HEAD: `214d2b49eff7bb78e4459161a381f646ddf2034b`
- `git status --porcelain`: vacío
- `git diff --check`: OK, sin salida
- ADB: exactamente un dispositivo autorizado en estado `device`
- Serial: `ZY32LHS6PS`
- Modelo: `moto_g15` (Moto G15)
- Proceso `com.lataba.rider.staging`: ausente; foreground service: ausente

## Staging remoto

- Proyecto/ref: `la-taba-staging` / `ukxqbgswjlibmnjemrzd`
- Business ID: `00000000-0000-4000-8000-000000000001`
- Pedidos activos: cero
- Rider QA elegido: `d1c72b84-1ab5-4a0a-989f-80f6843b609f`
- Membership: activa, rol `rider`
- Entrega activa del Rider elegido: cero
- GPS activo: cero
- Locks operativos: cero
- Outbox QA pendiente: cero
- Pedido nuevo: no creado
- APK: no instalado

## Resultado

El precheck queda limpio para iniciar una nueva preparación de pedido QA. El smoke físico todavía no se ejecutó.

Sólo se validará GPS físico real del Moto G15 en staging. Sin Mercado Pago, ARCA, diseño, historias ni producción.
