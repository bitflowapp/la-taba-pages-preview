# Matriz de confiabilidad — recepción Negocio

Fecha: 2026-08-02

| Escenario | Autoridad/estímulo | Mecanismo esperado | Cobertura | Resultado actual |
|---|---|---|---|---|
| Pedido creado antes de abrir Negocio | Snapshot PostgreSQL inicial | La pestaña reconstruye toda la bandeja activa | Unit + E2E separado | PASS |
| Pedido creado durante la suscripción | Snapshot posterior a `SUBSCRIBED` | Cierra ventana snapshot/suscripción | Unit + E2E | PASS |
| Evento Realtime duplicado | Invalidation repetida | Coalescing + dedupe `order_id/revision` | Unit | PASS |
| Evento viejo luego de nuevo | Snapshot r2 después de r3 | Watermark impide regresión | Unit | PASS |
| Realtime perdido | `CHANNEL_ERROR` + PostgreSQL disponible | Bandeja se conserva; polling/snapshot recupera | Unit + E2E panel real | PASS |
| Realtime silencioso | Sin eventos | Polling autoritativo permanente | Diseño + timer ejercitado indirectamente | PASS |
| Panel offline | `navigator.onLine=false` | Estado offline; no vacía lista | Unit + E2E | PASS |
| Vuelta online | evento `online` | Snapshot inmediato | Unit + E2E | PASS |
| BFCache/reapertura | `pageshow` | Snapshot inmediato | Unit + E2E | PASS |
| Vuelta a primer plano | `visibilitychange` visible | Snapshot inmediato | Unit + E2E panel real | PASS |
| Cierre y reapertura completa | Nueva instancia | Bootstrap desde PostgreSQL, sin cache PII | Unit + E2E | PASS |
| Dos pestañas | BroadcastChannel | Ambas consultan y convergen | Unit + E2E | PASS |
| Tres pestañas | BroadcastChannel + Web Locks | Tres convergen; una alerta total | Unit + E2E | PASS |
| Cierra la primera pestaña | Sin líder fijo | Otra pestaña sigue invalidando/consultando | Unit + E2E | PASS |
| Membership de otro comercio/inactiva | Auth + RLS + filtro runtime | No inicializa bandeja | Auth unit existente/ampliado | PASS |
| Token expirado | Auth 401/JWT expired | No autoriza; error recuperable/signed out | Auth unit | PASS |
| Payload Realtime parcial | Payload sólo como invalidación | Nunca se muestra el payload | Unit + E2E parcial | PASS |
| Snapshot PostgreSQL parcial | Validación fail-closed | Conserva último snapshot completo | Repository unit | PASS |
| 50 pedidos consecutivos | 50 invalidaciones rápidas | Coalescing, 50 UUID únicos, orden estable | Unit | PASS |
| Doble confirmación del cliente | Dos llamadas simultáneas | Una creación en vuelo + idempotencia backend | Repository unit | PASS |
| `submitted→accepted→preparing` | Revisiones 1→2→3 | Avanza y descarta r2 tardía | Unit | PASS |
| Pedido pasa a terminal | Snapshot activo deja de incluirlo | Se elimina y conserva watermark/tombstone | Unit | PASS |
| Eventos con igual `created_at` | `order_events.sequence` | Historia por sequence | Repository unit | PASS |
| Orden de tarjetas con empate | Estado + `createdAt` + UUID | Orden determinista | Unit | PASS |
| Consulta falla | Error PostgREST/Network | No aplica `[]`, no vacía | Unit + E2E | PASS |
| Estado visual antes del primer éxito | Sin snapshot exitoso | Nunca dice Conectado | Unit/DOM E2E | PASS |
| Estado visual tras snapshot | PostgreSQL OK | Conectado + última sincronización | E2E panel real | PASS |
| Más de 500 activos | Snapshot 501 | Falla cerrada, nunca trunca | Repository contract | PASS (guard) |
| Smoke Supabase staging real | RPC/UI autorizada | Runner fijado al project ref; 3 sintéticos, panel real, RT cortado, offline, 3 tabs, revisión atrasada, dedupe, recarga y cleanup por UUID | 1/1; 3/3 cancelados; baseline ajeno intacto | PASS |

## Invariantes verificadas

- PostgreSQL decide contenido, pertenencia y revisión final.
- Realtime nunca aplica una tarjeta y nunca es condición para seguir consultando.
- Un fallo no borra la última bandeja confirmada.
- No se persiste PII de pedidos en storage entre recargas.
- No hay más de una tarjeta por UUID backend.
- No hay más de una alerta por pedido entre pestañas cooperantes.
- Una pestaña recién abierta no depende de otra pestaña para recuperar datos.
