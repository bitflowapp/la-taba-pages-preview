# TABA2 — cierre visual premium · artefactos de revisión

Worktree: `C:\1212\la-taba2-mobile-design-integration`
Rama: `integration/taba2-mobile-design-review`
Base: `9315efe` · Final: ver `git log`

Preview LAN: **http://192.168.1.39:8080/index.html?demo=1**

## Carpetas

| Carpeta | Qué contiene |
| --- | --- |
| `moto-before/` | Moto G15 real sobre el build base (`9315efe`), servido en `:8081` |
| `moto-after/` | Moto G15 real sobre el build final, servido en `:8080` |
| `playwright/before/` | Emulación 432×960 @2.5 del build base |
| `playwright/final/` | Emulación 432×960 @2.5 del build final |
| `playwright/promo/` | Bloque "Ofertas del día" con una promoción válida sembrada por probe |
| `playwright/wip*/` | Iteraciones intermedias del ciclo referencia → ajuste → captura |

## Cómo se capturó el Moto

Dispositivo `ZY32LHS6PS`, 1080×2400 físicos a 400 dpi → **432×960 CSS, DPR 2,5**.

```
adb devices -l
adb shell wm size        # Physical size: 1080x2400
adb shell wm density     # Physical density: 400
adb exec-out screencap -p > captura.png
```

Dos detalles que cambian el resultado y conviene no repetir:

1. **`adb exec-out ... > archivo.png` desde PowerShell corrompe el PNG.** El
   redirect de PowerShell 5.1 escribe UTF-8 con BOM sobre un flujo binario. Hay
   que redirigir desde un shell POSIX.

2. **El preview tiene que servirse con `Cache-Control: no-store`.** Con
   `python -m http.server` el Moto conservó `styles/tokens.css` en cache HTTP y
   la iteración midió un build viejo: el token crema llegaba vacío y las
   tarjetas aparecían sin fondo. Se veía como un defecto de producto y no lo
   era. El origen `http://192.168.1.39:8080` no es contexto seguro, así que no
   hay service worker de por medio: era cache HTTP pura.

## Pares antes / después recomendados

| Antes | Después | Qué mirar |
| --- | --- | --- |
| `moto-before/01-home.png` | `moto-after/01-home.png` | encabezado, tarjetas crema, precio en grafito, asomo de la tercera |
| `moto-before/02-home-scroll-1.png` | `moto-after/02-home-scroll-1.png` | hero promocional |
| `moto-before/04-home-scroll-3.png` | `moto-after/04-home-scroll-3.png` | banner de marca y selección del local |
| `moto-before/06-catalogo.png` | `moto-after/06-catalogo.png` | tarjeta de catálogo y plato del packshot |
| `moto-before/08-seguimiento.png` | `moto-after/08-seguimiento.png` | fin de la losa blanca |
| — | `moto-after/09-filtros.png` | bottom sheet crema con Limpiar / Aplicar |
| — | `moto-after/10-favoritos-vacio.png` | estado vacío que antes era texto invisible (1,09:1) |
| — | `playwright/promo/ofertas-del-dia.png` | promo card real, con una promoción aprobada sembrada por probe |
| — | `playwright/desktop/` | 320, 768 y 1280 tras reordenar el encabezado |
