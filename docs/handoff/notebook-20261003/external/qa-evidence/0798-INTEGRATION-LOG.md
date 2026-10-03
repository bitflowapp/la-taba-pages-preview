# INTEGRATION-LOG — TABA2-PILOT-RC2-CANDIDATE.1

Bitácora cronológica de lo que esta sesión ejecutó, en el orden del
`TABA2_MASTER_RELEASE_PLAN.md` (sha256 `d756fdbf…4587a`, verificado antes de leerlo).

Regla aplicada en todo el documento: se registra lo medido. Donde algo no se
ejecutó, dice que no se ejecutó.

---

## Paso 0 — Verificación previa a mutar

| Comprobación | Resultado |
| --- | --- |
| SHA-256 del plan | `d756fdbfc2181f2fab9fa4e23b3101f37c0867e2aedb731e19809ef13404587a` ✅ idéntico al esperado |
| HEADs web/Rider del encargo (`3d69e6b`, `7cec5a7`) | ✅ coinciden con el repositorio real |
| 9 ancestros web de §3.1 | ✅ los 9 son ancestros y sus SHAs coinciden |
| 8 ancestros Rider de §3.3 | ✅ los 8 son ancestros |
| `feature/rider-map-location-contracts` (`898cea6d`) | ✅ NO es ancestro de `7cec5a7`, tal como declara el plan |
| Worktrees base | ✅ ambos limpios |
| 61 worktrees web | ✅ coincide |
| Locks | ✅ 10 leídos, ninguno tocado |

### Discrepancias encontradas

**D-1 — `taba2-pilot-ops.txt` declara `FINAL_HEAD=1fc2d94`, la rama está en `03c2fbdf`.**
Investigado antes de decidir: `1fc2d94` **es ancestro** de `03c2fbdf`; la rama tiene
encima un commit de documentación (`docs(ops): el lock de staging rota de dueño…`).
El lock quedó escrito un commit antes del cierre. No hay contradicción de contenido:
el plan apunta al head real de la rama. **Se integró `03c2fbdf`.**

**D-2 — El Moto G15 estaba accesible, contra lo que declaraba un lock activo.**
`taba2-walter-commercial-demo.txt` (ACTIVO) dice `MOTO_G15_TOCADO=false` porque el
teléfono aparecía `unauthorized` en ADB. En esta sesión `adb devices -l` devuelve
`ZY32LHS6PS device product:lamu_g model:moto_g15`, es decir autorizado. Es un cambio
de estado del dispositivo, no una contradicción del plan. **No se tomó el
`moto-g15.lock` ni se tocó el teléfono**, porque el gate que lo necesita (G5) es
inejecutable por otra razón —ver PILOT-READINESS.md.

**D-4 — El APK instalado en el Moto no era el que su lock declaraba.**
Al adquirir `moto-g15.lock` para cerrar P0.7, el `base.apk` en el dispositivo tenía
sha256 `ee0032cf…` mientras el lock declaraba `81633242…`. La misma sesión demostró
después que Android conserva el APK byte a byte —al instalar el candidato, el hash
extraído del teléfono resultó idéntico al archivado—, así que la diferencia **no es un
artefacto del sistema de archivos**. Refuerza C4 del plan, que ya denunciaba varios
hashes de APK sin un manifiesto que dijera cuál manda. Quedó resuelto para el
candidato: lo que está instalado ahora sí coincide con lo archivado.

**D-3 — La irreproducibilidad del esquema es peor de lo que enumera el plan.**
Ver «Fase D» más abajo. El plan identifica correctamente el problema (P0.2/C11);
esta sesión midió que además alcanza a dos funciones públicas que el plan no lista.

---

## Fase A — Preservar y congelar

1. **Registro de HEADs** → `evidence/A-heads-registro.txt`.
2. **Tags de auditoría locales** (sin push):
   - web `TABA2-AUDIT-20260808-WEB-BASE` → `3d69e6b…`
   - web `TABA2-AUDIT-20260808-WEB-OPS` → `03c2fbdf…`
   - rider `TABA2-AUDIT-20260808-RIDER-BASE` → `7cec5a7…`
3. **Bundles verificados fuera de `D:\1212`** → `C:\Users\marco\taba2-rc2-bundles\`.
   Ambos con `git bundle verify` = *records a complete history* / *is okay*.
   El del Rider es especialmente relevante: ese repo **no tiene remoto**, así que
   hasta ahora existía en una sola copia y un solo disco.
4. **Captura read-only de staging**: 6 Edge Functions con `ezbr_sha256`
   → `evidence/A-staging-edge-functions-readonly.json`. **Cero filas exportadas.**

**No ejecutado:** publicar ramas/tags al remoto y crear remoto del Rider (P0.1). El
encargo prohíbe `push`. Los bundles son el «mínimo inmediato» que el propio plan
admite como sustituto temporal, no el cierre del P0.

**No ejecutado:** P0.14/P0.15. Son actas de autorización/consentimiento y un plan de
datos aprobado; no son artefactos que un agente pueda producir. Por eso esta sesión
**no clonó staging, no copió filas y no capturó ninguna coordenada nueva**, que es
exactamente lo que esos P0 bloquean. La inspección read-only de metadatos sí está
permitida por el plan y es lo único que se hizo.

---

## Fase B — Worktrees limpios

```
git -C C:\Users\marco\dev\la-taba-pages-preview worktree add \
  -b release/taba2-pilot-rc2 D:\1212\worktrees\taba2-pilot-rc2-web 3d69e6b…
git -C D:\1212\la-taba-rider-android worktree add \
  -b release/taba2-rider-pilot-rc2 D:\1212\worktrees\taba2-rider-pilot-rc2 7cec5a7…
```

Ambos worktrees nuevos y aislados. **Fuentes intactas**: verificado después de
crearlos que `release/taba2-first-physical-e2e`, `feature/taba2-pilot-ops` y
`release/taba2-rider-first-physical-e2e` siguen en su SHA original.

`npm ci` en el worktree web (los worktrees nuevos no traen `node_modules`).
`flutter pub get` en el del Rider, por lo mismo.

Los nueve ancestros se documentaron como no-op con `merge-base --is-ancestor`.
**No se mergeó Panel, Tracking, storefront, real-orders ni catálogo base.**

### G0 y G1 sobre la baseline (antes de sumar nada)

| Gate | Resultado |
| --- | --- |
| Worktree limpio | ✅ 0 entradas |
| `git diff --check` | ✅ |
| Inventario de migraciones | ✅ 57, sin versión duplicada |
| `npm run check` | ✅ |
| `npm run migrations:validate` | ✅ 57 en orden, sin ERROR ni WARNING |
| `npm run secrets:scan` | ✅ limpio |
| `npm test` | ✅ **1119/1119** |
| `npm run test:webhook` | ✅ **12/12** |
| `npm run test:e2e` | ⚠️ **206 pasaron, 1 falló** |

**El fallo del E2E baseline, sin maquillar.** Falló
`tests/e2e/direct-ordering-growth.spec.mjs` esperando el marcador GPS del rider.
Es la **base intacta `3d69e6b`**, sin un solo cambio mío. Reejecutado el mismo spec
aislado: **pasa en 7,1 s**. Durante la corrida completa había otra sesión activa
(`taba2-walter-commercial-demo`) capturando pantalla y corriendo su propio stack, y
el config de Playwright advierte que la concurrencia produce timeouts no
deterministas. La lectura honesta es *saturación del host*, no regresión — pero
**un pase aislado no es prueba suficiente**, así que queda anotado como riesgo y el
veredicto real lo da la corrida sobre el candidato.

---

## Fase C — Única integración del piloto

```
git merge --no-ff --no-commit feature/taba2-pilot-ops
→ Automatic merge went well; stopped before committing as requested
```

Predicción del plan confirmada: **cero archivos co-modificados** por ambos deltas
desde el merge-base `c7c3bbd5348b` (Physical tocó 35, Ops tocó 23, intersección 0),
y **cero conflictos textuales**.

Índice revisado completo antes de commitear — 23 archivos, +6356/−3:

| Riesgo semántico que el plan marcó | Qué se encontró |
| --- | --- |
| Edición histórica de `20260806160000` | Sólo **agrega** líneas: `drop function` previo (sin él, reconstruir desde cero aborta ahí), `revoke … from public, anon` + `grant … to authenticated` (el drop reabría EXECUTE a `anon`) y un `comment`. **Una sola corrección**, como exige P0.4. |
| 5 migraciones fuera del orden temporal de staging | Aportan `20260807110000…150000`. La base aporta `160000` y `170000`. **Ninguna versión duplicada con SQL distinto.** |
| ACL de `get_rider_queue` | Es exactamente lo que la corrección restituye. Queda pendiente la sonda viva contra staging (G3). |
| `package.json` y comandos de gate | **Sólo agrega** `pilot:ops:drill`. Ningún comando de gate modificado ni debilitado. |
| Dependencias de Panel y catálogo | `business-operations-center.js`, `business-panel-render.js`, `production-operations.js`, `supabase-operations-repository.js`, `styles/business.css`. Sin borrados. |

**Merge commit `--no-ff`: `9952c9e15e335c5cd46e39a2b0cf1a2e8b8e7a10`**
padres `3d69e6b…` y `03c2fbdf…`. Árbol limpio. Sin push, sin amend, sin rebase.

---

## Fase D — Autoridad de migraciones

### Lo que se midió antes de escribir una línea

El plan dice que la base no es reproducible. Esta sesión lo cuantificó:

1. **Ninguna migración del repo web crea el schema `private` ni las tablas del mapa.**
   Verificado con búsqueda exhaustiva: cero coincidencias de `create schema` y cero
   de `create table … rider_map…`.
2. **Tres migraciones del repo web las consumen**: `20260806160000` (lee el payload),
   `20260807160000` (documenta la dependencia) y `20260807170000`, que hace
   `alter table private.rider_map_business_locations` — sobre una tabla que nadie creó.
3. El SQL de procedencia vive en el **repo del Rider**, en `898cea6d`
   (`supabase/migrations/20260804090000_rider_map_location_contracts.sql`, 405 líneas).
   El repo web sólo guarda un documento read-only de 147 líneas que dice «NO EJECUTAR».
4. **Hallazgo adicional, no enumerado en el plan (D-3):** las versiones vigentes en el
   repo web de `public.rider_order_rpc_payload` (`20260801040000`) y
   `public.rider_active_delivery_payload` (`20260802100000`) **no leen el mapa**,
   mientras que las desplegadas en staging **sí**. Es decir: aunque se crearan las
   tablas, una base limpia dejaría al Rider sin `business_location` ni
   `customer_location` — justo lo que el piloto tiene que demostrar.

### La migración de reconciliación

`supabase/migrations/20260807155000_rider_map_location_contract_reconciliation.sql`

- **Versión**: `20260807155000`, después de la última de Ops (`…150000`) y antes de
  las físicas que dependen del mapa (`…160000`, `…170000`). Inventario global
  confirmó el número libre. Total de la cadena: **63 migraciones, sin duplicados**.
- **Base limpia** → crea el contrato completo: schema `private`, las dos tablas con
  su forma base, RLS, revokes, la función de trigger, el trigger sobre `public.orders`,
  `private.rider_map_location_payload`, y las dos proyecciones públicas con
  coordenadas (por el hallazgo D-3). **Rama ejercitada**: es la que corre en el drill.
- **Staging** → detecta el contrato completo y es no-op: no reemplaza funciones.
  **Rama NO ejercitada**: garantizada por diseño, no probada. Y es la que va a correr
  contra staging, así que hay que verificarla sobre el clon antes de G3.
- **Estado parcial** → `raise exception` antes de mutar. Un contrato a medias no se
  completa a ciegas. **Rama NO ejercitada**, mismo motivo.
- **No redefine `public.get_rider_queue`**: esa función es propiedad de
  `20260806160000` con la corrección de Observabilidad. Reescribirla acá la revertiría.
- **No renombra ni reejecuta** `20260804090000_rider_map_location_contracts`. La fila
  del historial remoto se conserva.

### G2 — evidencia medida

`npm run pilot:ops:drill` (local-only, contenedores propios `taba2-rc2-drill-*`
para no pisar a otra sesión) → **SIMULACRO APROBADO**, exit 0:

| Métrica | Valor |
| --- | --- |
| Migraciones replicadas desde cero sobre PostgreSQL vacío | **63** |
| Reconstrucción desde migraciones en un segundo clúster | **63** |
| Tablas con contenido idéntico tras restore | **69** |
| Comprobaciones de contrato operativo | **72**, verificadas antes del backup y otra vez sobre el proyecto recuperado |
| Restauración | 328 ms |

Evidencia: `artifacts/pilot-ops-restore-drill.json` en el worktree del candidato.

**Esto es lo más importante que produjo la sesión**: la cadena del candidato ahora
se reproduce desde cero. Antes de esta migración eran 62 y abortaban en
`20260807170000`.

### Lo que G2 todavía NO tiene

- Restore de un **snapshot exacto y reciente de staging** en un clon aislado, y el
  mismo upgrade retroactivo con el mismo comando/flags/orden. **Bloqueado por
  P0.14/P0.15**: clonar staging copia filas reales de personas.
- Por lo mismo, no hay diff de esquema/historial/ACL/conteos del clon antes y después.
- Las sondas RLS/ACL vivas contra staging (`anon` no ejecuta `get_rider_queue`)
  quedan para G3.

---

## Fase E — Corrección P0.8 del Rider

### Diagnóstico

El defecto estaba anotado como hallazgo en `moto-g15.lock` («arranque en frío SIN RED
pierde el reparto activo en pantalla aunque está en disco») y el plan lo eleva a P0
en C7. Localizado en `android/…/MainActivity.kt`:

```kotlin
RiderMethodChannel.GET_DELIVERY_SERVICE_STATUS -> {
    deliveryServiceCoordinator.snapshot()                                    // ← se descarta
    deliveryServiceCoordinator.reconcileWithBackend(ordersDataSource.getAssignedOrder())
}
```

`getDeliveryServiceStatus` es la lectura **durable y local** —`ActiveDeliveryStore`
escribe `active_delivery.json` en `noBackupFilesDir` con `fsync` y move atómico— pero
llamaba incondicionalmente a `getAssignedOrder()`, que es un **RPC de red**. Sin red
la excepción se propaga, el puente devuelve *failure*, y el `snapshot()` local de la
línea anterior se calculaba y se tiraba. Resultado: la entrega activa desaparece de
la pantalla aunque esté intacta en disco.

### El arreglo

El coordinador tiene un invariante deliberado: *«A stored file alone is never treated
as proof that tracking is active»*, y `reconcileWithBackend(null)` significa «el
servidor declara que no hay reparto» → detiene el servicio. Correcto. Pero **un
transporte caído no declara nada**. Confundir ambos es la causa raíz.

- `ActiveDeliveryPolicy.backendAnswered(error)` — decisión pura, sin dependencias de
  Android: `false` sólo para `orders_network_unavailable` (transporte caído) y
  `orders_server_unavailable` (5xx). Todo lo demás —401, 403, conflicto de revisión,
  4xx— **sí** es una respuesta del servidor y se propaga como antes.
- `MainActivity` usa esa decisión: si el backend no contestó, devuelve el estado
  durable en vez de fallar la llamada entera.

No se tocó nada más. **No se trajo `898cea6d` al APK.**

### Pruebas

5 tests nuevos en `ActiveDeliveryPolicyTest` (JVM, sin emulador): sin red no
respondió; 5xx tampoco es respuesta; 401, 403 y conflicto de revisión **sí** lo son
y deben seguir propagándose.

### G4 y las 36 fallas JVM preexistentes

`flutter analyze` → *No issues found!*. `flutter test` → 254/254.
`ActiveDeliveryPolicyTest` → 7/7. Build limpio de ambas APKs → `BUILD SUCCESSFUL`,
archivadas con SHA-256 en `artifacts-rider/`.

Pero la suite JVM de Kotlin tiene **36 fallas** en `SessionManagerTest` (8) y
`RiderRpcDataSourceTest` (28), todas por `Method w in android.util.Log not mocked`
—el proyecto no configura `testOptions.unitTests`—.

Para no atribuirlas ni descartarlas por intuición se **midió** la base: se
restauraron los 3 archivos del fix a `ff6d014~1` con `git checkout <ref> -- <paths>`,
se corrió la misma tarea, y se devolvieron dejando el árbol limpio y el HEAD intacto.
Resultado: **las mismas 36 fallas, clase por clase**. Son preexistentes.

Aun así **G4 no se declara verde**: el gate pide la suite JVM en verde. Arreglarlo
exige tocar la configuración de tests del proyecto, que está fuera del alcance de RC2.

### Incidencia de build

El primer intento falló por `local.properties` ausente (archivo local, gitignoreado,
que los worktrees nuevos no traen) y después por cachés incrementales de Kotlin
corruptas en `url_launcher_android` —plugin de terceros, no código del proyecto—.
Se resolvió con `local.properties` replicado, borrado de `build/` (que además G4
exige: build limpio, sin reutilizar `build/`) y `-Pkotlin.incremental=false`.
