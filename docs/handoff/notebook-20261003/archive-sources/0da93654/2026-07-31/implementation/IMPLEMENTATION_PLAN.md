# TABA — Plan de implementación

**Nada de este plan fue ejecutado.** El worktree `C:\1212\la-taba-catalog-checkout-premium` no fue modificado.

## Regla previa

El árbol tiene trabajo sin commitear de otro agente (checkout por Perfil, direcciones guardadas, demo-realtime, relay autoritativo, tests nuevos). **Antes de la etapa 1 hay que:**

1. Coordinar con quien esté trabajando en `js/ui.js`, `js/business.js`, `js/realtime.js`, `js/core/realtime-sync.js`, `index.html` y `styles/checkout.css`.
2. Que ese trabajo llegue a un punto commiteable.
3. Recién entonces empezar, **por CSS**, que es donde menos colisiona.

Ignorar esto garantiza conflictos en los archivos más grandes del proyecto.

## Orden y por qué

```
1 Tokens + stack inferior     ← desbloquea P0-01, P1-03, R5
2 Tarjeta de producto          ← desbloquea P0-02, P0-03, P1-07
3 Meta y estado vacío          ← desbloquea P1-06, P1-04, P1-05
4 Header, categorías, dirección ← consolida P0-03, P1-08, P1-09
5 Negocio móvil                ← P1-01, P1-02
6 Negocio escritorio
7 Catálogo escritorio
8 Pruebas visuales
9-13 Rider Android
```

Las etapas 1 a 4 son secuenciales: cada una depende de la anterior. Las 5-6 y la 7 pueden ir en paralelo con equipos distintos. Las 9-13 sólo empiezan después de la **fase 0 del backend** (`rider-android/RIDER_ANDROID_MIGRATION_PLAN.md`).

---

## Etapa 1 · Sistema de diseño y tokens

**Objetivo:** una sola fuente de verdad para el chrome inferior y desaparición del solape.

Entregables: tokens nuevos, reserva declarada en `body`, `data-cart` en el body, eliminación de los cuatro valores contradictorios de altura de nav, escala de z-index, colores accesibles.

**Criterio de aceptación medible:**
- 0 nodos de texto cruzados por el stack al final del scroll en 320/375/390/393/412/430/768, con carrito vacío y lleno.
- Con carrito vacío, la reserva es 0 (sin espacio muerto).
- 0 `z-index` literales fuera de la escala.
- Contraste de la matriz de tokens sin fallos.

**Riesgo principal:** los tokens los consumen 6 archivos. Se mitiga cambiándolos **todos juntos en un commit** y verificando con capturas de las 6 vistas × 6 viewports.

## Etapa 2 · Panel del negocio móvil

Se adelanta respecto de la tarjeta si hay presión operativa: es la superficie donde el usuario pierde más tiempo hoy. Requiere la etapa 1 sólo para el chrome.

**Criterio:** ≥2 tarjetas de pedido completas sobre el pliegue en 390×844; ≤200px consumidos antes del primer pedido; 0 elementos de navegación con scroll horizontal.

## Etapa 3 · Panel del negocio escritorio

**Criterio:** ≥5 pedidos visibles sin scroll en 1280×900; scroll independiente por panel; una sola acción primaria visible; 0 desbordamiento en 768–1920.

## Etapa 4 · Catálogo y tarjetas

**Criterio:** ≥2 precios sobre el pliegue en 390×844; área del packshot ≥30 % de la tarjeta; 0 intersecciones entre el control de cantidad y el título con nombres largos; 0 objetivos <44px.

## Etapa 5 · Detalle de producto

Hoja inferior en móvil, `<dialog>` en escritorio. **Criterio:** foco atrapado y devuelto; `Esc` cierra; producto sin precio no se puede agregar.

## Etapa 6 · Carrito sticky y navegación

Barra de carrito con altura fija y `bottom` derivado; nav a sangre de 56px; toast por encima del stack.
**Criterio:** el mismo test de solape de la etapa 1, ahora con la barra real; la barra no existe con carrito vacío.

## Etapa 7 · Responsive y accesibilidad

Barrido de los 11 breakpoints, corrección de objetivos táctiles, `aria-*`, foco, `prefers-reduced-motion`.
**Criterio:** 0 incumplimientos en el chequeo automático; recorrido con teclado completo; VoiceOver y TalkBack en catálogo y checkout.

## Etapa 8 · Pruebas visuales

Regresión visual sobre las 6 vistas × 11 viewports, con umbral de diferencia y aprobación manual de los cambios esperados.

## Etapas 9 a 13 · Rider Android

Detalladas en `rider-android/RIDER_ANDROID_MIGRATION_PLAN.md`. Resumen:

| Etapa | Contenido | Bloqueante |
|---|---|---|
| 9 | **Fase 0 del backend**: máquina de estados, RPCs, RLS, `command_log`; migración de la vista rider web a esos RPCs | **Sí, para todo lo demás** |
| 10 | Andamiaje Flutter, tokens generados, CI | 9 |
| 11 | Autenticación y lectura de pedidos contra staging | 10 |
| 12 | Cola durable, transiciones, offline, ubicación, notificaciones | 11 |
| 13 | Certificación y despliegue progresivo | 12 |

## Distribución del trabajo

### Claude Opus

- Decisiones de diseño y jerarquía visual.
- **Etapa 1 completa** — es quirúrgica, de alto riesgo y con una trampa de CSS no evidente (el token derivado que no resuelve).
- Anatomía de la tarjeta (etapa 4) y eliminación del control absoluto.
- Arquitectura del negocio móvil (etapa 2) y del master-detail (etapa 3).
- Máquina de estados y contrato de backend del rider (etapa 9).
- Revisión visual de cada captura de regresión.
- Revisión de accesibilidad donde hace falta criterio, no sólo umbral.

### Codex

- Sustitución mecánica de `z-index` por tokens en los 11 archivos.
- Barrido de objetivos táctiles y `aria-label` una vez definidas las reglas.
- Migración y ampliación de la suite E2E a los 11 breakpoints.
- Infraestructura de regresión visual y su integración en CI.
- Andamiaje Flutter (etapa 10) siguiendo la estructura ya especificada.
- Generador de `taba_tokens.dart` desde `TOKENS.json`.
- Builds, firmado, artefactos y matriz de dispositivos.
- Tests de contrato contra Supabase staging.

### Revisión humana

- **Elección visual final** entre las variantes que se propongan.
- Prueba física en iPhone y Android reales, sobre todo las safe areas (la emulación devuelve 0).
- Copy comercial y nombres de producto.
- Validación operativa con el encargado del local: ¿la banda de estado refleja cómo trabaja?
- Decisión sobre la variante de nombre de los productos duplicados.
- Decisión comercial sobre el alcance de la v1 del rider.
- Aprobación de cada etapa del despliegue progresivo del rider.

## Qué NO hacer

- No empezar por Flutter antes de la fase 0 del backend.
- No tocar `styles/tracking.css` en este trabajo.
- No mezclar la etapa 1 con cambios de contenido: si algo se rompe, hay que poder revertir sólo los tokens.
- No apagar la vista rider web antes de la etapa 8.4 del despliegue.
- No aplicar la etapa 1 sin verificar antes la estrategia de caché de `sw.js`.
