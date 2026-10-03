# ADR-005 — Observabilidad mínima sin coordenadas ni secretos

Estado: Propuesto  
Fecha: 2026-08-02

## Contexto

GPS background falla por permisos, OEM, batería, red, reloj, sesión y contrato server-side. Sin métricas, soporte no puede distinguir captura, cola y publicación. A la vez, loggear coordenadas/order ids/tokens crea un riesgo de privacidad.

## Decisión

Implementar un logger/metrics interface con allowlist. Registrar app/API/device bucket, service state, permission/network state, sampling mode, freshness bucket, queue depth/oldest age bucket, retry/error kind, duración, batería bucket y servidor sequence solo como contador/edad. Para correlación usar un hash no reversible y rotado de scope, nunca el identificador crudo. Crash reports deben aplicar la misma redacción.

La visibilidad pública sigue siendo la del contrato Gate2: latest, rounded, stale-window. La retención interna de rider_locations y la purga deben verificarse en staging y tener owner/periodo antes del release; no se infiere una política completa desde un test estático.

## Alternativas consideradas

1. Loggear payload completo para debugging: descartado por PII/secreto.
2. No instrumentar para “reducir riesgo”: descartado; impide operar el producto.
3. Guardar historial completo en el rider: descartado para MVP; aumenta privacidad y batería.
4. Publicar cada evento a analytics: descartado hasta tener clasificación/retención aprobadas.

## Consecuencias

Positivas: diagnóstico accionable sin transformar logcat en una base de ubicaciones.  
Negativas: algunos incidentes necesitarán reproducirse con un build de debug controlado; hashes y buckets deben documentarse.

## Requisitos de aceptación

- Static scan y logcat físico no muestran token, coordenada, dirección, order id crudo ni body.
- Un incidente sintético permite saber si falló permission, FLP, queue, session, network o RPC.
- La retención/purge live tiene owner y evidencia.
- Los eventos bridge contienen solo campos permitidos.
