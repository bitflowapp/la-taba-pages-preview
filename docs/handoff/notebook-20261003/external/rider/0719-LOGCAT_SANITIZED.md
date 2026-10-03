# Logcat sanitizado - smoke staging

Fecha: 2026-08-02  
Alcance: ventana posterior a `adb logcat -c`, instrumentation staging y smoke de lanzamiento. No se conserva el log raw.

| Búsqueda | Coincidencias |
|---|---:|
| `FATAL EXCEPTION` | 0 |
| `AndroidRuntime` | 0 |
| `ANR` | 0 |
| `FlutterError` | 0 |
| `foreground service` | 0 |
| `bridge` | 1 |
| `permission` | 29 |
| `location` | 6 |
| `token refresh` | 0 |
| `outbox` | 0 |
| `claim` | 0 |
| `delivery completion` | 0 |

Las coincidencias de servicio, bridge, permisos y ubicación se limitaron a conteos: no se guardaron líneas que pudieran incluir tokens, emails, teléfonos, direcciones, códigos, coordenadas, seriales o IDs personales. Los cuatro indicadores de crash/ANR permanecieron en cero.
