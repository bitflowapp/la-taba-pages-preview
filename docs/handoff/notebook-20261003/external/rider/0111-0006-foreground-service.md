# ADR-0006: Foreground service de ubicación

- Estado: aceptado.
- Decisión: `RiderForegroundService` tipo `location`, notification channel persistente, `stopWithTask=false`, no `onTaskRemoved` que detenga, y stop inmediato ante terminal/logout/emergency stop.
- Alternativas: isolate Flutter; WorkManager; AccessibilityService.
- Motivo: Android exige una ejecución visible para una captura sostenida; WorkManager no es streaming; AccessibilityService no es apropiado ni permitido.
- Consecuencia: permisos, notification y restricciones OEM son parte del producto y de la prueba física. Force stop no es recuperable automáticamente.

