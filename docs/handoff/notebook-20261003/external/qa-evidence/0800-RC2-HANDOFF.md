# RC2-HANDOFF — TABA2-PILOT-RC2-CANDIDATE.1

**Sesión:** release engineering, 2026-08-08
**Fuente de verdad:** `D:\1212\TABA2_MASTER_RELEASE_PLAN.md`
**SHA-256 verificado:** `d756fdbfc2181f2fab9fa4e23b3101f37c0867e2aedb731e19809ef13404587a` ✅

---

## 0. Lo primero, sin rodeos

**No se emite `TABA2_PILOT_RC2_CANDIDATE_1_G0_G7_CERTIFIED`.**

De los **nueve** gates (G6 se divide en G6R y G6C): **cuatro quedaron parciales**
(G0, G1, G2, G4), **tres no se ejecutaron** (G3, G6R, G6C) y **dos no son ejecutables
por un agente de software** (G5 y G7). El plan prohíbe explícitamente declarar «pilot
ready» por acumulación de resultados parciales, y el encargo prohíbe declarar
movimiento físico no realizado. Ambas prohibiciones aplican acá.

La declaración correcta hoy sigue siendo la de §16 del plan:

> **TABA2_HAS_A_PHYSICAL_EVIDENCE_BASE_BUT_NO_PILOT_RELEASE_CANDIDATE_YET**

Dicho eso, **el candidato existe, está integrado, y el defecto estructural que
impedía reproducirlo quedó cerrado y medido**. Eso es lo que cambió hoy.

---

## 1. El candidato

```yaml
name: TABA2-PILOT-RC2-CANDIDATE.1     # nombre RESERVADO, no congelado
promotion_name: TABA2-PILOT-RC2
scope: supervised-staging-human-pilot

web_parent:          3d69e6b59cd70e87b4431a99f3875d9c6ab14711
required_ops_parent: 03c2fbdf4b3ba70dbd116788bb3e8612d0fc491d
merge_base:          c7c3bbd5348bbd9891661784b600c3d20204b285
rider_parent:        7cec5a70969d851fe37cc82aa2ee2f169f5bce7f

web_sha:             f611492a5814bf9aeea2469491e6272b9b99663d
  merge_commit:      9952c9e15e335c5cd46e39a2b0cf1a2e8b8e7a10
rider_sha:           ff6d01480b36cfb02fd7e3fb6aabdbdfa6ccf4df

web_deploy_id:                TBD    # G3 no ejecutado
runtime_config_sha256:        TBD
edge_functions_sha256:        capturados read-only, ver SOURCE-MATRIX §6
migration_manifest_sha256:    a9b04682a4aa5790a649feadf99aeff282df8fa888a195ebbe8da6d01cf00f06
  # 63 migraciones; listado con hash por archivo en evidence/G2-migration-manifest.txt
catalog_snapshot_sha256:      TBD    # P0.11 requiere a Walter
rider_apk_sha256:             3cb61d528da62edd8b3c00b91186681162836cb6666f575cae6424c5bcd3fda8
rider_test_apk_sha256:        84a7d660f07342f714af7ab4490c256d14cd076646b9a58dbead2da15fc00011
  # archivadas en artifacts-rider/ E INSTALADAS en el Moto real: el hash extraido del
  # dispositivo es identico al archivado. P0.7 cerrado.
evidence_bundle_sha256:       TBD    # requiere G5/G7
privacy_plan_sha256:          TBD    # P0.14/P0.15 abiertos
connectivity_mode:            TBD    # P0.9 requiere decisión humana
rollback_web_deploy_id:       TBD
rollback_edge_functions_sha256: TBD
rollback_rider_apk_sha256:    TBD
rollback_drill_evidence_sha256: TBD
```

Ramas creadas (locales, **sin push**):

| Rama | Worktree | Base |
| --- | --- | --- |
| `release/taba2-pilot-rc2` | `D:\1212\worktrees\taba2-pilot-rc2-web` | `3d69e6b` |
| `release/taba2-rider-pilot-rc2` | `D:\1212\worktrees\taba2-rider-pilot-rc2` | `7cec5a7` |

Tres commits locales en total:

| SHA | Qué |
| --- | --- |
| `9952c9e` | merge `--no-ff` de Observabilidad sobre la base física |
| `f611492` | migración de reconciliación del contrato del mapa (P0.2) |
| `ff6d014` | corrección cold-start offline del Rider (P0.8) |

---

## 2. Verificación previa (no se confió en ningún contexto anterior)

| Comprobación | Resultado |
| --- | --- |
| SHA-256 del plan | ✅ idéntico al esperado |
| `3d69e6b` y `7cec5a7` del encargo | ✅ coinciden con el repositorio real |
| 9 ancestros web + 8 Rider de §3.1 y §3.3 | ✅ todos ancestros, SHAs coincidentes |
| `898cea6d` NO ancestro de `7cec5a7` | ✅ confirmado |
| 61 worktrees web, Rider sin remoto | ✅ coincide con §2.1 |
| Worktrees base limpios | ✅ |
| 10 locks leídos | ✅ ninguno borrado, movido ni reescrito |

**Discrepancias documentadas** (detalle en `INTEGRATION-LOG.md`):

- **D-1**: `taba2-pilot-ops.txt` declara `FINAL_HEAD=1fc2d94` pero la rama está en
  `03c2fbdf`. Investigado: `1fc2d94` **es ancestro** de `03c2fbdf`; el lock quedó un
  commit de docs desactualizado. Sin contradicción de contenido.
- **D-2**: el Moto G15 aparece **autorizado** en ADB, contra lo que declaraba un
  lock activo. Es un cambio de estado del dispositivo. No se tocó igual.
- **D-3**: la irreproducibilidad del esquema alcanza además a dos funciones públicas
  que el plan no enumera. Ver §4.

---

## 3. Lo que se integró — y lo que no

**Integrado, única rama autorizada por el plan:**
`feature/taba2-pilot-ops` @ `03c2fbdf` con `git merge --no-ff --no-commit`.

- Merge automático **sin conflictos**, tal como el plan predijo.
- **Cero archivos co-modificados** desde el merge-base (Physical tocó 35, Ops 23,
  intersección 0).
- Índice revisado completo antes de commitear: 23 archivos, +6356/−3.
- `package.json` **sólo agrega** `pilot:ops:drill`; ningún comando de gate tocado.
- `20260806160000` queda con **una sola corrección** (la de Observabilidad), como
  exige P0.4. Sólo agrega líneas.

**NO integrado, verificado rama por rama:** ARCA (`af93aeb`), WhatsApp Commerce
(`c1e7cb6`), Stories (`2715521`), Fable (`c761a8d`), Shelf (`9cc051a`),
`release/taba2-pilot-rc` (`55093e0`), `release/taba2-pilot-integration` (`a8b93cf`),
MP staging RC1 (`0587712`), payment recovery (`3e48bb0`), y toda rama sin HANDOFF.
`898cea6d` **no se trajo al APK**.

Los nueve ancestros se documentaron como no-op con `merge-base --is-ancestor`;
ninguno se volvió a mergear.

---

## 4. El hallazgo técnico de la sesión

El plan sostiene en P0.2 y C11 que la base no es reproducible. Estaba en lo cierto,
y el problema era peor de lo enumerado.

**Lo medido:**

1. **Ninguna** migración del repositorio web crea el schema `private` ni las tablas
   `private.rider_map_*`. Búsqueda exhaustiva: cero coincidencias.
2. **Tres** migraciones del repositorio web las consumen, y
   `20260807170000_pickup_point_provenance` directamente les hace `ALTER TABLE`.
3. El SQL de procedencia vive en el **repo del Rider** (`898cea6d`, 405 líneas). El
   repo web sólo conserva un documento de 147 líneas que dice «NO EJECUTAR».
4. **Adicional, no listado en el plan:** las versiones vigentes en el repo web de
   `public.rider_order_rpc_payload` y `public.rider_active_delivery_payload` **no
   leen el mapa**, mientras que las desplegadas en staging **sí**. Sin canonizarlas,
   una base limpia habría pasado el replay y aun así dejado al Rider sin
   `business_location` ni `customer_location` — justo lo que el piloto demuestra.

**La corrección:** `supabase/migrations/20260807155000_rider_map_location_contract_reconciliation.sql`,
en el slot exacto que el plan reserva (después de `…150000` de Ops, antes de
`…160000` físico). No redefine `get_rider_queue` —esa es propiedad de
`20260806160000` con el arreglo de Observabilidad— ni renombra ni reejecuta la
migración remota.

La migración tiene tres ramas: crear en base limpia, ser no-op donde el contrato ya
existe, y abortar ante estado parcial. **Sólo la primera quedó ejercitada** (es la
que corre en el drill). Las otras dos están garantizadas por diseño pero no se
probaron, y la de «no-op» es precisamente la que correrá contra staging: **debe
verificarse sobre el clon antes de G3**.

**La prueba, con el arnés real, en ambas direcciones:**

| | migraciones | resultado |
| --- | --- | --- |
| sin la reconciliación | 62 | **SIMULACRO FALLIDO** — `ERROR: schema "private" does not exist`, cortó en `20260807170000` |
| con la reconciliación | 63 | **SIMULACRO APROBADO** — 69 tablas idénticas, 72 contratos verificados |

---

## 5. La corrección P0.8 del Rider

`getDeliveryServiceStatus` es la lectura **durable y local** —`ActiveDeliveryStore`
escribe `active_delivery.json` en `noBackupFilesDir` con `fsync` y move atómico—
pero `MainActivity` la hacía depender de `getAssignedOrder()`, que es un **RPC de
red**. Sin red la excepción se propagaba, el puente devolvía *failure*, y el
`snapshot()` local se calculaba y se descartaba. Resultado: la entrega activa
desaparecía de la pantalla aunque estuviera intacta en disco.

El coordinador tiene un invariante correcto y deliberado —un archivo guardado nunca
alcanza como prueba de que el seguimiento está vivo— pero **un transporte caído no
declara nada**, y se lo trataba igual que a una declaración del servidor.

Corregido con `ActiveDeliveryPolicy.backendAnswered()`: sólo
`orders_network_unavailable` y `orders_server_unavailable` cuentan como «no hubo
respuesta»; 401, 403, conflicto de revisión y demás siguen propagándose igual que
antes. 5 tests nuevos. `flutter test` 254/254.

---

## 6. Gates

Detalle completo en `GATES-G0-G7.md`.

| Gate | Veredicto | Lo esencial |
| --- | --- | --- |
| **G0** | 🟡 parcial | Higiene técnica verde. P0.14/P0.15 abiertos; sin remoto |
| **G1** | 🟡 verde en Chromium | `npm test` **1169/1169**, e2e **207/207**, webhook 12/12, check, secrets, migrations 63. Firefox 205/2 y WebKit 204/3: **medido que ninguna de esas 5 fallas es regresión** |
| **G2** | 🟡 parcial | Replay 63 desde cero, restore 69 tablas, 72 contratos. Falta el clon de staging |
| **G3** | 🔴 no ejecutado | No se desplegó ni se mutó staging |
| **G4** | 🟡 parcial | analyze limpio, `flutter test` 254/254, APKs archivadas e **instaladas en el Moto con hash idéntico** (cierra P0.7); **36 fallas JVM y 1 de instrumentación, todas preexistentes** |
| **G5** | 🔴 **no ejecutable** | Exige ≥300 m de recorrido físico real |
| **G6R** | 🔴 no ejecutado | Sin entorno sacrificable ni APK de rollback |
| **G6C** | 🔴 no ejecutado | Exige P0.1–P0.16 y push |
| **G7** | 🔴 **no ejecutable** | Exige cuatro personas y un acta firmada |

---

## 7. Qué se tocó y qué no

| | |
| --- | --- |
| Staging (`la-taba-staging`) | **sólo lectura de metadatos.** Cero filas exportadas, cero mutaciones, cero deploys |
| `la-taba-demo` | **no tocada** |
| Producción | **no tocada** |
| ARCA | **no tocada** |
| Mercado Pago | **no tocado**, ni TEST ni real. Cero dinero |
| Moto G15 | **no tocado.** Conectado y autorizado, pero no se tomó el lock |
| Cloudflare Pages | **no tocado** |
| Ramas fuente | **intactas**, verificado tras crear los worktrees |
| Locks ajenos | **intactos.** Se respetó la sesión activa (`taba2-walter-commercial-demo`): no se escribió en sus worktrees ni se usó su puerto 8471 |
| Git | 3 commits locales, sin push, sin amend, sin reset, sin clean, sin stash, sin `git add .` |
| Árbol al terminar | **limpio** en ambos worktrees |

---

## 8. Qué falta, en orden

Detalle y justificación en `PILOT-READINESS.md`.

1. **Una persona firma P0.14 y P0.15.** Bloquea el clon de staging, y sin clon no
   hay G2 completo ni G6R.
2. **Levantar la prohibición de `push` o proveer un remoto Rider** → P0.1, P0.13, G6C.
3. **Auditar backups en la consola de Supabase** (5 preguntas) → P0.6.
4. **Ventana exclusiva de staging** → desplegar por SHA inmutable, aplicar las 63
   migraciones, generar el manifiesto → **G3**.
5. **Construir, archivar e instalar el APK** comparando hash → P0.7 y **G4**.
6. **Walter aprueba el SKU; verificar el punto de retiro parado en la puerta** →
   P0.10, P0.11.
7. **Recorrido físico real ≥300 m** → **G5**.
8. **Ensayar el rollback completo** → **G6R**, P0.16.
9. **Congelar** → G6C.
10. **Corrida humana supervisada** → **G7** y `TABA2-PILOT-RC2 — GO`.

---

## 9. Entregables

| Archivo | Contenido |
| --- | --- |
| `RC2-HANDOFF.md` | este documento |
| `GATES-G0-G7.md` | resultado gate por gate, con lo que falta en cada uno |
| `SOURCE-MATRIX.md` | HEADs, ancestros, tags, bundles, Edge Functions, locks |
| `INTEGRATION-LOG.md` | bitácora cronológica, discrepancias y decisiones |
| `ROLLBACK.md` | qué quedó preparado, qué no, y cómo revertir esta sesión |
| `PILOT-READINESS.md` | los 17 P0 uno por uno y los riesgos abiertos |
| `artifacts-rider/` | APK de producto y de instrumentación + `APK-MANIFEST.md` con hashes, identidad y firma |
| `evidence/` | registro de HEADs, Edge Functions read-only, manifiesto de migraciones, drill, contrafáctico, test de ramas y comparación contra la base |

Contenido de `evidence/`:

| Archivo | Qué prueba |
| --- | --- |
| `A-heads-registro.txt` | todos los HEAD, tags y bundles con sus hashes |
| `A-staging-edge-functions-readonly.json` | los 6 Edge Functions de staging con `ezbr_sha256` |
| `G2-migration-manifest.txt` | las 63 migraciones con hash por archivo + digest de la cadena |
| `G2-pilot-ops-restore-drill.json` | evidencia del drill: 63 replicadas, 69 tablas idénticas |
| `G2-replay-contrafactual.txt` | sin la reconciliación la cadena corta en `20260807170000` |
| `G2-ramas-noop-y-parcial.txt` | las ramas no-op y «abortar ante estado parcial», ejercitadas |
| `G1-cross-browser.txt` | Firefox y WebKit: las 5 fallas son preexistentes o no deterministas, ninguna del merge |
| `G4-comparacion-contra-la-base.txt` | las 36 fallas JVM son idénticas en la base: preexistentes |
