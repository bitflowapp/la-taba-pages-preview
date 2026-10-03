# ADR-0004: Cola GPS durable, cifrada y con TTL

- Estado: aceptado.
- Decisión: Room o equivalente durable con cifrado por clave Keystore, FIFO por entrega, límite global/per-delivery y TTL de 3 minutos. Drenaje con mínimo server-compatible de 5 s.
- Alternativas: memoria; WorkManager ilimitado; replay de toda la ruta.
- Motivo: Gate 2 rechaza muestras con más de 3 minutos y el GPS histórico no debe persistir.
- Consecuencia: pérdida de red no conserva todas las muestras; descartar una muestra vencida es correcto y observable.
- Revisión vieja, terminal o pérdida de autorización purga o detiene según política de `ANDROID_LIFECYCLE.md`.

