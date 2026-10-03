# PILOT-READINESS — TABA2-PILOT-RC2-CANDIDATE.1

## Veredicto

> ### El candidato NO está listo para piloto humano.
> ### La declaración `TABA2_PILOT_RC2_CANDIDATE_1_G0_G7_CERTIFIED` **no se emite**.

El plan es explícito: *«No se declara "pilot ready" por acumulación de resultados
parciales»*. Esta sesión produjo resultados sustantivos —y una prueba que el plan
pedía y no existía— pero de los **nueve** gates (G6 se divide en G6R y G6C):

- **cuatro quedaron parciales**: G0, G1, G2, G4;
- **tres no se ejecutaron**: G3, G6R, G6C;
- **dos no son ejecutables por un agente de software** en ninguna circunstancia:
  G5 y G7.

La declaración permitida hoy sigue siendo la de §16 del plan:

> **TABA2_HAS_A_PHYSICAL_EVIDENCE_BASE_BUT_NO_PILOT_RELEASE_CANDIDATE_YET**

---

## 1. Por qué no se puede certificar G0–G7 desde esta sesión

No es una cuestión de tiempo ni de esfuerzo. Hay tres clases de bloqueo distintas
y conviene no confundirlas.

### Clase A — Requieren un ser humano haciendo algo físico

| Gate / P0 | Qué exige textualmente | Por qué no lo puedo hacer |
| --- | --- | --- |
| **G5** / P0.9 | *«Ruta segura ≥300 m y ≥5 min, con ≥20 puntos aceptados, traza compatible con calles/tiempos y desplazamiento mayor que la incertidumbre; dos fixes aislados no alcanzan»* | Requiere que alguien **camine o maneje** con el Moto G15 encima. El teléfono está conectado y autorizado por ADB, pero ADB no lo mueve por la calle. El plan además advierte: *«sin confundir deriva con movimiento»*. Fabricar esa traza sería exactamente la mentira que el encargo prohíbe. |
| **P0.10** | *«Medición parado en la puerta»*, `human_verified=true` | Requiere presencia humana en Mendoza 827. El punto sigue `human_verified=FALSE`, `confidence=medium`, y Google Maps no lo reconoce como «La Taba 2». |
| **G7** / P0.17 | *«Cliente humano usa el storefront. Operador humano usa el Panel. Rider humano lleva el Moto. Acta PILOT-GO/NO-GO firmada»* | Son cuatro personas. No es automatizable por definición: el gate existe justamente para probar que el sistema funciona con gente real. |
| **P0.11** | *«Walter aprueba al menos un SKU no alcohólico, precio, stock, envío, mínimo, horario y cobertura»* | Es una decisión comercial del dueño del negocio. |

### Clase B — Requieren una autorización que no me corresponde dar

| Gate / P0 | Qué exige | Estado |
| --- | --- | --- |
| **P0.14** | Base legal/autorización para tratar datos existentes y **consentimiento de toda persona** que participe en pruebas de ubicación, antes del primer clon o recorrido | **Abierto.** Es un acta, no un artefacto técnico. |
| **P0.15** | Saneamiento, ACL, cifrado y dueño del borrado programado de la evidencia | **Abierto.** |

Estos dos no son burocracia: **bloquean G2 y G6R**. El plan los pone como
prerrequisitos tempranos —*«bloquean cualquier clon con filas de staging»*— y por
eso esta sesión **no clonó staging, no copió una sola fila y no capturó ninguna
coordenada nueva**. Sólo se leyeron metadatos en modo read-only, que es lo único
que el plan permite antes de cerrarlos.

### Clase C — Chocan con una restricción explícita del encargo

| Gate / P0 | Qué exige el plan | Qué dice el encargo |
| --- | --- | --- |
| **P0.1** | *«Publicar ramas/tags web; crear remoto Rider»* | **«sin push»** |
| **G6C** | *«Web y Rider pusheados»* | **«sin push»** |

Es una contradicción real entre el plan y las instrucciones, no una omisión mía. Se
resolvió por el camino que el propio plan admite como *«mínimo inmediato»*: bundles
verificados en almacenamiento externo, fuera de `D:\1212`. **P0.1 queda parcial y
G6C no se puede cerrar** sin que alguien levante la prohibición de `push` o provea
un remoto.

---

## 2. Estado de los 17 P0

| P0 | Estado | Detalle |
| --- | --- | --- |
| P0.1 Preservar el código | 🟡 **parcial** | Tags locales + 2 bundles verificados fuera de `D:\1212`. Falta remoto/push. |
| P0.2 Canonizar el esquema del mapa | 🟢 **cerrado en replay** | Migración `20260807155000`. Medido: sin ella el replay corta en `20260807170000`; con ella, 63 migraciones desde cero. Las **tres ramas** (crear / no-op / abortar ante estado parcial) quedaron ejercitadas. Falta el upgrade sobre clon real de staging (P0.14/P0.15). |
| P0.3 Integrar Observabilidad | 🟢 **cerrado** | Merge `--no-ff` `9952c9e`, cero conflictos, G0–G1 sobre el resultado. |
| P0.4 Historial/ACL | 🟡 **parcial** | Una sola corrección de `20260806160000`, verificada por diff. Falta la sonda viva de que `anon` no ejecuta `get_rider_queue` en staging (es G3). |
| P0.5 Staging inmutable | 🔴 **abierto** | No se tomó ventana ni se desplegó. |
| P0.6 Backups hosted | 🔴 **abierto** | Las 5 preguntas de la consola de Supabase siguen sin responder. |
| P0.7 Rider reproducible | 🟢 **cerrado** | Build limpio desde el head candidato; APK de producto y de instrumentación archivadas con SHA-256; **instaladas en el Moto real y hash extraído del dispositivo idéntico al archivado** (`3cb61d52…`). |
| P0.8 Cold-start offline | 🟢 **cerrado en código** | Causa raíz encontrada y corregida con prueba (ver INTEGRATION-LOG §Fase E). Falta la validación en el Moto real, que es G5. |
| P0.9 Movimiento y conectividad | 🔴 **abierto — Clase A** | Nadie movió el teléfono. No se afirma lo contrario. |
| P0.10 Verificar pickup | 🔴 **abierto — Clase A** | `human_verified=FALSE`. |
| P0.11 Surtido del piloto | 🔴 **abierto — Clase A** | Requiere a Walter. |
| P0.12 Repetir E2E final | 🔴 **abierto** | Requiere G3 + G5. |
| P0.13 CI exacto | 🔴 **abierto** | No hay CI corriendo sobre estos HEAD; sin remoto no puede haberlo. |
| P0.14 Privacidad previa | 🔴 **abierto — Clase B** | |
| P0.15 Proteger evidencia | 🔴 **abierto — Clase B** | |
| P0.16 Ensayar rollback | 🔴 **abierto** | G6R no ejecutado. |
| P0.17 Ensayo humano | 🔴 **abierto — Clase A** | Es G7. |

**Cerrados: 4 de 17** (P0.2, P0.3, P0.7 y P0.8). El plan exige P0.1–P0.16 cerrados
sólo para *congelar* el candidato (G6C), y P0.17 para *promoverlo*.

---

## 3. Lo que esta sesión sí movió

No todo es bloqueo. Lo que cambió de estado, con evidencia medida:

1. **El candidato existe y está integrado.** `9952c9e` + `f611492` sobre
   `3d69e6b`, con la única rama que el plan autoriza (`03c2fbdf`) y ninguna otra.

2. **La cadena de migraciones ya es reproducible desde cero.** Era el corazón de
   P0.2 y de C11, y estaba roto de una forma verificable: nada creaba el schema
   `private` y `20260807170000` le hacía `ALTER TABLE`. Medido con el arnés real:

   | | migraciones | resultado |
   | --- | --- | --- |
   | sin la reconciliación | 62 | **SIMULACRO FALLIDO** — `schema "private" does not exist` |
   | con la reconciliación | 63 | **SIMULACRO APROBADO** — 69 tablas idénticas, 72 contratos |

3. **P0.8 tenía una causa raíz concreta, no un misterio.** `getDeliveryServiceStatus`
   —la lectura local y durable— dependía de un RPC de red y trataba un transporte
   caído como si el servidor hubiera declarado «no hay reparto». Corregido y probado.

4. **Se descubrió un hueco que el plan no enumeraba**: las proyecciones
   `rider_order_rpc_payload` y `rider_active_delivery_payload` del repo web no leen
   el mapa, mientras que las de staging sí. Sin canonizarlas, una base limpia habría
   pasado el replay y aun así dejado al Rider sin coordenadas.

5. **El repo del Rider dejó de tener una sola copia.** No tiene remoto; ahora hay un
   bundle verificado en otro disco.

---

## 4. Camino más corto a `TABA2-PILOT-RC2-CANDIDATE.1 — FROZEN`

En orden, porque cada uno destraba al siguiente:

1. **Una persona firma P0.14 y P0.15.** Sin esto no se puede clonar staging, y sin
   clon no hay G2 completo ni G6R.
2. **Levantar la prohibición de `push` o dar un remoto para el Rider** → cierra P0.1
   y habilita P0.13 (CI) y G6C.
3. **Auditar backups en la consola de Supabase** (5 preguntas) → P0.6.
4. **Ventana exclusiva de staging** → desplegar el candidato por SHA inmutable,
   aplicar las 63 migraciones, generar el manifiesto → **G3**.
5. **Construir, archivar e instalar el APK**, comparando hash → cierra P0.7 y **G4**.
6. **Walter aprueba el SKU y verifica el punto de retiro parado en la puerta** →
   P0.10 y P0.11.
7. **Un rider humano hace un recorrido real de ≥300 m** → **G5**.
8. **Ensayar el rollback completo** sobre entorno sacrificable → **G6R** y P0.16.
9. **Congelar** → G6C. Recién ahí el nombre deja de ser una plantilla.
10. **Corrida humana supervisada** → **G7**, y sólo entonces `TABA2-PILOT-RC2 — GO`.

---

## 5. Riesgos que quedan abiertos

| Riesgo | Severidad | Nota |
| --- | --- | --- |
| El candidato nunca tocó staging | Alta | Todo lo verde de esta sesión es local. C13 del plan advierte que un gate verde por RPC ya dio una falsa sensación de seguridad una vez. |
| La reconciliación de migraciones nunca corrió contra el esquema vivo | Alta | En staging debe ser no-op; está diseñada y probada para eso en base limpia, **no comprobada contra staging**. |
| El APK que estaba instalado en el Moto no era el que su lock declaraba | Alta | Medido: en disco `ee0032cf…`, declarado `81633242…`. Como Android conserva el APK byte a byte (probado en la misma sesión), es una discrepancia real de trazabilidad, no del sistema de archivos. Refuerza C4 del plan. Ya quedó resuelto para el candidato: lo instalado ahora **sí** coincide con lo archivado. |
| El candidato nunca se ejercitó en un reparto real | Alta | El APK está instalada y verificada por hash, pero no hubo recorrido, ni entrega, ni código de entrega. Eso es G5 y G7. |
| 36 tests JVM del Rider fallan por `android.util.Log` no mockeado | Media | **Medido**: la base sin el fix da exactamente las mismas 36 fallas (8 + 28). Son preexistentes y el proyecto no configura `testOptions.unitTests`. No los introduje, pero **G4 no puede declararse verde** con ellos rojos, y arreglarlos está fuera del alcance de RC2. |
| ~~Un spec de Playwright falló en la baseline~~ | — | **Cerrado.** La suite completa sobre el candidato pasó 207/207 en Chromium; el fallo era saturación del host por una sesión concurrente. |
| La suite E2E no es estable en Firefox ni en WebKit | Media | Firefox 205/2, WebKit 204/3. **Medido que ninguna falla es regresión del merge**: en Firefox los specs aislados pasan 11/11 tanto en la base como en el candidato; en WebKit dos fallan determinísticamente en ambos árboles por limitaciones del navegador (`waitForEvent("download")`, `setInputFiles`) y una tercera se mueve sola entre corridas de código idéntico. Es deuda del arnés, no del producto, pero deja G1 sin poder declararse verde en los tres navegadores. |
| El punto de retiro sigue provisional | Media | `human_verified=FALSE`; Maps devuelve un plus code, no el nombre del comercio. |
| Backups de staging sin auditar | Media | No hay política de backup demostrada, hay una suposición. |
| Sin CI sobre estos HEAD | Media | Consecuencia directa de no tener remoto. |
| El catálogo no converge | Baja para el piloto | El piloto usa un solo SKU aprobado; igual hay que fijarlo. |
