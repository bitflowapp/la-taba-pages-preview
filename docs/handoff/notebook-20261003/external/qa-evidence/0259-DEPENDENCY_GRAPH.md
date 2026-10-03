# TABA — Grafo de dependencias

## Etapas web

```
                     ┌──────────────────────────────┐
                     │ 0 · Coordinar con el trabajo │
                     │    sin commitear del árbol   │  ← BLOQUEANTE DE TODO
                     └──────────────┬───────────────┘
                                    ▼
                     ┌──────────────────────────────┐
                     │ 1 · Tokens + stack inferior  │
                     └──┬────────┬─────────┬────────┘
              ┌─────────┘        │         └──────────┐
              ▼                  ▼                    ▼
   ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │ 2 · Negocio    │  │ 4 · Tarjeta de   │  │ 6 · Carrito      │
   │     móvil      │  │     producto     │  │     sticky + nav │
   └───────┬────────┘  └────────┬─────────┘  └────────┬─────────┘
           ▼                    ▼                     │
   ┌────────────────┐  ┌──────────────────┐           │
   │ 3 · Negocio    │  │ 5 · Detalle de   │           │
   │     escritorio │  │     producto     │           │
   └───────┬────────┘  └────────┬─────────┘           │
           │                    ▼                     │
           │           ┌──────────────────┐           │
           │           │ 7 · Catálogo     │           │
           │           │     escritorio   │           │
           │           └────────┬─────────┘           │
           └────────────────────┼─────────────────────┘
                                ▼
                     ┌──────────────────────────────┐
                     │ 8 · Responsive + a11y        │
                     └──────────────┬───────────────┘
                                    ▼
                     ┌──────────────────────────────┐
                     │ 9 · Regresión visual en CI   │
                     └──────────────────────────────┘
```

**Paralelizable:** las ramas 2→3, 4→5→7 y 6 pueden avanzar a la vez con equipos distintos, siempre después de la etapa 1.

## Etapas rider

```
┌───────────────────────────────────────┐
│ R0 · Máquina de estados + RPCs + RLS  │  ← BLOQUEANTE ABSOLUTO
│      en Supabase                      │
└──────────────────┬────────────────────┘
                   ▼
┌───────────────────────────────────────┐
│ R1 · La vista rider WEB migra a esos  │  ← valida el contrato con tráfico real
│      RPCs                             │
└──────────────────┬────────────────────┘
                   ▼
┌───────────────────────────────────────┐
│ R2 · Andamiaje Flutter + CI + tokens  │
└──────────────────┬────────────────────┘
                   ▼
┌───────────────────────────────────────┐
│ R3 · Autenticación y sesión           │
└──────────────────┬────────────────────┘
                   ▼
┌───────────────────────────────────────┐
│ R4 · Lectura de pedidos + Realtime    │
└──────────────────┬────────────────────┘
                   ▼
┌───────────────────────────────────────┐
│ R5 · Cola durable + transiciones      │  ← el hito de mayor riesgo
└──────────────────┬────────────────────┘
                   ▼
      ┌────────────┴────────────┐
      ▼                         ▼
┌──────────────┐        ┌──────────────────┐
│ R6 · GPS     │        │ R7 · Notificac.  │
└──────┬───────┘        └────────┬─────────┘
       └───────────┬─────────────┘
                   ▼
┌───────────────────────────────────────┐
│ R8 · Certificación                    │
└──────────────────┬────────────────────┘
                   ▼
┌───────────────────────────────────────┐
│ R9 · Despliegue progresivo (8.1→8.5)  │
└───────────────────────────────────────┘
```

**R5 antes que R6** deliberadamente: primero se garantiza que ninguna acción se pierde, y después se añade la ubicación. Al revés, un fallo de la cola se confunde con un fallo del GPS.

## Dependencias entre artefactos

```
design-system/TOKENS.json
   ├─► styles/tokens.css            (web, manual, revisado)
   └─► lib/app/theme/taba_tokens.dart (Android, GENERADO en el build)

rider-android/RIDER_ANDROID_STATE_MACHINE.md
   ├─► esquema y RPCs de Supabase
   ├─► vista rider web migrada
   ├─► app Android
   └─► panel del negocio (mismos nombres de estado)

design-system/CROSS_PRODUCT_CONSISTENCY.md (vocabulario)
   ├─► copy del cliente
   ├─► copy del negocio
   ├─► copy del rider
   └─► copy del seguimiento
```

## Dependencias externas

| Dependencia | Etapa que la necesita | Riesgo si falla |
|---|---|---|
| Supabase staging operativo | R0 en adelante | Bloquea toda la rama rider |
| Cuenta de Firebase (FCM) | R7 | Sin avisos de pedido nuevo |
| Cuenta de Play Console | R9 | Sin distribución |
| Estilo de MapLibre auto-hospedado | R6 | El mapa cae si depende de un CDN |
| esbuild (ya es dependencia) | Etapa 13 web | Sigue la cadena de `@import` |

## Ruta crítica

**Web:** 0 → 1 → 4 → 6 → 8 → 9. Todo lo demás cuelga de ahí.
**Rider:** R0 → R1 → R2 → R3 → R4 → R5 → R8 → R9. R6 y R7 son paralelos entre sí.

El elemento de mayor apalancamiento del proyecto es la **etapa 1**: desbloquea P0-01, P1-03 y R5 del mapa de riesgo de CSS, y es requisito de todas las demás etapas web.
