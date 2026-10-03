# ADR-001 — Captura GPS propiedad del ForegroundService nativo

Estado: Propuesto  
Fecha: 2026-08-02

## Contexto

La app tiene Flutter para UI y un RiderForegroundService Kotlin que actualmente solo muestra notificación/persiste metadata. Los componentes LocationSource/Sampler/Publisher son placeholders y el APK no incluye un proveedor de ubicación. El requisito operativo es continuar con pantalla apagada y publicar por el RPC Gate2 exacto.

## Decisión

El servicio nativo es dueño de FusedLocationProviderClient, sampling, filtro, cola y uploader. Flutter únicamente solicita start/stop, observa snapshots/eventos sanitizados y muestra freshness. El servicio se inicia desde Activity visible con FOREGROUND_SERVICE_LOCATION y ACCESS_FINE_LOCATION. No se solicita ACCESS_BACKGROUND_LOCATION para el MVP; una necesidad de operar fuera de FGS sería un cambio de producto y privacidad.

Usar un actor único por order_id/revision, con un floor local de publicación de seis segundos. Captured_at proviene de la ubicación; recorded_at/sequence provienen del servidor. El cliente llama exactamente publish_rider_location con los ocho valores de su firma y no añade idempotency_key.

## Alternativas consideradas

1. Capturar GPS en Flutter: descartada; el isolate y la UI no son una base de continuidad de background.
2. Usar WorkManager para captura continua: descartada; sirve para trabajo diferible/drain, no para una ruta continua de baja latencia.
3. Usar un servicio propio sin FLP: descartada; aumenta complejidad de sensores y no resuelve restricciones de batería.
4. Pedir background location desde el inicio: descartada para MVP; amplía permisos y no resuelve force-stop/OEM.

## Consecuencias

Positivas: continuidad clara, tokens y ubicación quedan nativos, testability con interfaces fake y Flutter no puede filtrar coordenadas por accidente.  
Negativas: aumenta código Kotlin, dependencia/size de Play Services, necesidad de instrumented/physical tests y coordinación estricta de lifecycle.

## Requisitos de aceptación

- El servicio obtiene un fix preciso con pantalla apagada en Moto.
- QualityFilter evita rango/accuracy/edad inválidos.
- Uploader maneja sesión/errores sin depender de Flutter.
- Test de contrato demuestra firma Gate2; smoke staging devuelve sequence.
- Logs no contienen coordenadas, tokens ni cuerpos.
