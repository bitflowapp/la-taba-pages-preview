# PRODUCTION_RISKS — Riesgos, prioridades y bloqueos

## Cinco prioridades críticas

| Prioridad | Por qué es crítica | Gate de salida |
|---|---|---|
| P0-1. GPS nativo y FGS real | Hoy no se adquiere ni publica ninguna ubicación. | Fix preciso en pantalla apagada, publish_rider_location aceptado en staging y estado Fresh observable. |
| P0-2. Cola offline y sesión dentro del servicio | Sin persistencia cifrada, una red intermitente o muerte de proceso pierde tracking; sin SessionManager el servicio no puede publicar seguro. | Room/queue con lease, AES-GCM, refresh single-flight y drain probado. |
| P0-3. Recuperación y consistencia de orden | Puede quedar on_the_way en backend pero detenido localmente; no hay lock/reconcile. | RecoveryPolicy, active intent cifrado, revisión CAS y matriz de process death/force-stop. |
| P0-4. Staging real y certificación física | Regex/tests locales no demuestran RLS, grants, OEM, Doze, batería o permiso. | Migración aplicada/validada, smoke tests y evidencia Moto reproducible. |
| P0-5. Release security/observabilidad | Production signing es debug/TODO y no hay métricas para operar un GPS fallido. | Signing real, build reproducible, logs sanitizados, métricas y retention owner aprobados. |

## Registro de riesgos

| ID | Riesgo | Prob. | Impacto | Mitigación/gate |
|---|---|---:|---:|---|
| R-01 | FGS sin FLP/uploader da falsa sensación de tracking. | Alta | Crítico | Task06 completo y smoke server sequence. |
| R-02 | COARSE produce precisión obfuscada/throttled y el backend rechaza o degrada datos. | Alta | Alto | Requerir fine para Start; test approximate-only. |
| R-03 | Start RPC y startForeground quedan separados por una muerte de proceso. | Media | Crítico | Task08 reconcile assigned/revision; recovery UX. |
| R-04 | Dos órdenes pisan ActiveDeliveryStore. | Media | Crítico | Lock por order scope, rechazo de conflicto y test de taps/recreation. |
| R-05 | ActiveDeliveryStore plano expone orden/estado. | Media | Alto | Envelope AES-GCM y migration/corrupt tests. |
| R-06 | Cola pierde muestras o publica con otra cuenta. | Media | Crítico | rider_scope, lease, encrypted payload, logout purge. |
| R-07 | Refresh concurrente filtra tokens o duplica requests. | Baja/Media | Crítico | Reusar SessionManager single-flight; interceptor audit. |
| R-08 | Gate2 local no está aplicado en ukxqbgswjlibmnjemrzd. | Alta | Crítico | Aplicación controlada, grants/RLS smoke y rollback plan. |
| R-09 | Revisión backend cambia mientras hay cola. | Media | Alto | 40001 handling, assigned refresh y no retry ciego. |
| R-10 | Backend rechaza muestras por frecuencia, edad o reloj. | Media | Alto | floor 6 s, captured_at validator, clock tests y métricas. |
| R-11 | WorkManager se usa como sustituto de tracking continuo. | Media | Alto | FGS para capture; worker solo drain acotado. |
| R-12 | OEM mata FGS, limita batería o cambia swipe/reboot behavior. | Alta | Crítico | Moto matrix, política de no-promesa y recovery. |
| R-13 | Force-stop impide auto-recuperación. | Alta | Alto | Copy explícito y manual recovery; no claim de garantía. |
| R-14 | Notification denied oculta awareness del servicio. | Media | Alto | Decisión fail-closed/limited y test Android 13+. |
| R-15 | Notificación “Detener” deja orden backend activa sin comprensión del rider. | Media | Alto | Renombrar Pausar, confirmación y recovery card. |
| R-16 | Map SDK/provider/key/retención no aprobados. | Media | Alto | Adapter y decisión previa; no inventar key. |
| R-17 | Completion no tiene contrato comprobado en rider. | Media | Crítico | Leer firma backend existente antes de Task09; bloquear si no existe. |
| R-18 | Release usa debug signing o config vacía. | Alta | Crítico | Keystore/CI/secret injection aprobados y fail-closed. |
| R-19 | Logcat/crash report registra coordenadas, tokens o PII. | Media | Crítico | Allowlist logger, static scan, physical log audit. |
| R-20 | Disco lleno impide validar suites actuales. | Alta | Medio/Alto | Liberar capacidad por procedimiento operativo aprobado; repetir tests sin borrar datos arbitrariamente. |
| R-21 | Retención de rider_locations no tiene owner/purge probado. | Media | Alto | Confirmar migración/política live y evidence de purge/retention. |
| R-22 | Tests de integración son placeholders y se cuentan como cobertura. | Alta | Alto | Reemplazar por casos ejecutables y publicar reportes. |

## Bloqueos de prueba física actuales

- No hay evidencia de un Moto de certificación disponible ni un runbook ejecutado.
- No se conoce un resultado real de pantalla apagada, swipe, Doze, battery saver, reboot, force-stop, permission revocation o Task Manager stop.
- No se ha medido batería/temperatura/cola durante una ruta.
- No hay comprobación física de pérdida/retorno de red con ACKs y freshness.
- No hay validación en Moto de la notificación, acción pause/recovery y estado de permiso Android 13+.
- El proveedor de mapa/navegación no está definido.
- El entorno de trabajo tiene D: sin espacio, por lo que Flutter/Node no pudieron ejecutar sus suites en esta auditoría.

## Release blockers

No aprobar release mientras cualquiera de estos puntos siga abierto:

1. No existe una muestra GPS real aceptada en staging por el RPC Gate2.
2. No existe cola durable cifrada con recuperación tras process death.
3. No existe prueba de 401/refresh/logout sin publicar con identidad vieja.
4. No existe matriz física firmada con modelo/versión/batería y timestamps.
5. No está validada la migración, RLS, grants y retención en la instancia staging.
6. Production APK no tiene signing de release y configuración segura.
7. Completion/recovery comercial no tiene contrato backend y UX aprobados.
8. Logs y reportes no pasan el scan de secretos/PII.

## Deuda aceptable solo con aprobación

Una primera versión puede posponer optimización fina de sampling, historial visual propio y analytics avanzada si conserva captura, cola, seguridad, recovery y frescura correctas. No puede posponer los bloques anteriores ni compensarlos con tests regex.
