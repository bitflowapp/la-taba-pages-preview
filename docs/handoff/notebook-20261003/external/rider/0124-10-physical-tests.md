# Prompt Codex — Etapa 10: pruebas físicas

Prepará y ejecutá la validación física en staging para la app rider.

Leé `TEST_MATRIX.md`, `ANDROID_LIFECYCLE.md`, `BACKEND_CONTRACT.md` y `SECURITY_MODEL.md`. Usá sólo cuenta QA, pedido QA y dispositivo aprobado (Moto G15 si sigue siendo el objetivo). No uses producción. Verificá login, lista, claim concurrente si hay dos riders, start, pantalla apagada, otra app, swipe de recientes, pérdida de red/cola, refresh, GPS apagado, freshness, MapLibre, confirmación de código, stop inmediato, reopen, reboot y Force stop.

No guardes ni muestres coordenadas, dirección, teléfono, email, tokens, JWT, apikey completa o código de entrega. Las evidencias deben usar hora redondeada, modelo/OS, estado, edad del fix, sequence y resultado categorizado.

Pruebas: checklist reproducible, logs sanitizados, screenshots sin PII y reporte de límites OEM/Android. Si falla un escenario, reportá causa y no “arregles” backend ni agregues RPC.

Aceptación: matriz completa con PASS/FAIL/BLOCKED, evidencia local no versionada y lista de aprobaciones para release. No hacer deploy, push ni modificar el backend.

