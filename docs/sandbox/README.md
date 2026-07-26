# TABA Sandbox local

La sandbox se activa exclusivamente con `?demo=1`. Usa `SandboxOrderRepository`, IndexedDB (`taba-sandbox`) y un canal `BroadcastChannel` con fallback al evento `storage` para sincronizar pestañas del mismo navegador. El estado se versiona con `SANDBOX_SCHEMA_VERSION` y puede exportarse, importarse o reiniciarse desde `?demo=1&tools=1`.

Las vistas directas son:

- `?demo=1#home`
- `?demo=1#business`
- `?demo=1#rider`
- `?demo=1#tracking`
- `?demo=1&tools=1`

El tracking de la sandbox usa una ruta genérica y una ETA local, sin geolocalización ni permisos GPS. El repositorio productivo no conoce este motor y permanece fail-closed fuera de la bandera explícita.

La sincronización está limitada al mismo navegador/dispositivo. Para sincronizar dispositivos distintos se requiere un backend autorizado.
