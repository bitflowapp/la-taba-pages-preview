# Prompt Codex — Etapa 7: cola offline

Implementá la cola GPS offline durable y cifrada.

Leé `ARCHITECTURE.md`, `ANDROID_LIFECYCLE.md`, `SECURITY_MODEL.md`, ADR-0004 y el contrato Gate 2. Usá Room o una alternativa durable aprobada con cifrado por Keystore. La cola debe ser FIFO por entrega, con límite global/per-delivery, TTL duro de 3 minutos, revision y captured_at por registro.

Al volver online, drená a través de `publish_rider_location`, nunca por tabla directa, con mínimo 5 s entre requests. Un 401 refresca una vez bajo mutex; 42501 detiene; 40001 fuerza snapshot; P0001 reprograma; terminal/pérdida de asignación purga. No reenvíes muestras vencidas y no mantengas historial.

Pruebas: persistencia tras process kill, TTL, límites, reconexión, refresh, revision conflict, rate limit, duplicados y purge terminal. Verificá que logs y base local no expongan tokens ni coordenadas fuera del registro cifrado.

Aceptación: ninguna muestra vieja sale a la red; la cola reporta count y motivos sanitizados; el service sigue operativo sin Flutter. No tocar backend.

