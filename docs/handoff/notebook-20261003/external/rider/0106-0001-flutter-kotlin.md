# ADR-0001: Flutter + Kotlin nativo

- Estado: aceptado para staging.
- Contexto: Flutter resuelve UI multiplataforma, pero Android debe capturar/publicar con Flutter pausado y respetar foreground service.
- Decisión: Dart contiene UI, dominio, casos de uso y repositorios; Kotlin contiene sesión, HTTP Supabase, GPS, cola y service. Se conectan por MethodChannel/EventChannel.
- Alternativas: todo Flutter con plugin de background; todo Kotlin con UI nativa; WebView/PWA.
- Motivo: un único ciclo de vida nativo y una única sesión permiten continuar sin depender del proceso Flutter. WebView/AccessibilityService quedan fuera.
- Consecuencia: existe un bridge que debe ser tipado y testeado; aumenta trabajo Kotlin, pero reduce divergencia de lifecycle.
- Reversión: sólo si se cambia explícitamente el requisito de pantalla apagada y se reaudita el contrato.

