# Smoke final de recepción Negocio en staging

Fecha: 2026-08-02  
Proyecto: `ukxqbgswjlibmnjemrzd`  
Business: `00000000-0000-4000-8000-000000000001`  
Run final: `intake-1785662116672-61b2be3c`

## Resultado

**PASS — 1/1 Playwright, 3 pedidos sintéticos creados y 3/3 cancelados.**

El panel usó Auth/RLS/PostgREST reales de staging. PostgreSQL fue la autoridad; el WebSocket de Realtime se cerró intencionalmente para demostrar recuperación por snapshot y polling.

## Escenarios aprobados

1. Panel abierto antes del pedido.
2. Descarte de revisión fuera de orden: r5 permanece ante r4 tardía usando el módulo real en navegador.
3. Pedido creado mientras Negocio ya estaba abierto.
4. Pedido creado antes de abrir una pestaña Negocio y recuperado por snapshot inicial.
5. Tres pestañas convergentes.
6. Snapshots repetidos sin tarjetas duplicadas.
7. Bandeja conservada offline y recuperada al volver online.
8. Una sola alerta entre tres pestañas.
9. Orden determinista de tarjetas.
10. `submitted→accepted→preparing` sin regresión, con revisión PostgreSQL creciente.
11. Recuperación tras recarga completa.
12. Una sola reserva de stock por pedido.
13. Cancelación y restauración exacta del stock.
14. Retiro de pedidos terminales de la bandeja activa.

## Pedidos del run final

| Código | UUID | Estado remoto final |
|---|---|---|
| `LT-0018` | `93f052d5-1fb1-4146-b5b6-4e4b84c15c28` | `cancelled` |
| `LT-0019` | `b8517c94-d372-4a33-82f2-0124d260aba3` | `cancelled` |
| `LT-0020` | `f940357e-6063-478e-a1b9-658ae4b5e408` | `cancelled` |

Los nueve pedidos sintéticos creados durante las tres ejecuciones controladas de esta operación quedaron en `cancelled`. La primera ejecución detectó una aserción visual incorrecta —`accepted` se presenta como “Preparando”— y también limpió 3/3 antes de salir; la corrección posterior valida el estado de dominio mediante la próxima transición y PostgreSQL.

## Evidencia saneada

- `staging-business-intake-result.json`
- `staging-business-intake-status.png`
- `staging-business-intake-synthetic-card.png`

Las capturas están recortadas al estado operativo y a una tarjeta sintética; no incluyen pedidos ajenos ni campos de login.

