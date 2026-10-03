# TABA2 — Master Release Plan

**Auditoría:** 2026-08-08, America/Buenos_Aires  
**Rol:** arquitectura principal y release management independiente  
**Alcance:** reconstrucción del estado; no se integró, desplegó ni modificó código.

## 0. Dictamen ejecutivo

**Estado actual: NO-GO para piloto humano y NO-GO para producción.**

No existe hoy una rama que merezca llamarse “la RC de TABA2”. La evidencia más fuerte está repartida entre dos repositorios, el esquema de staging acumula migraciones de ramas distintas y los artefactos finales no están publicados ni unidos por un manifiesto inmutable.

| Decisión | Resultado |
| --- | --- |
| Base web/backend con mayor evidencia | `release/taba2-first-physical-e2e` @ `3d69e6b59cd70e87b4431a99f3875d9c6ab14711` |
| Base Rider con mayor evidencia | `release/taba2-rider-first-physical-e2e` @ `7cec5a70969d851fe37cc82aa2ee2f169f5bce7f` |
| Base canónica de datos/migraciones | **No existe**: staging contiene una migración del mapa que no está en el repo web y hay números de versión reutilizados para SQL diferente |
| RC existente apta para piloto | **Ninguna** |
| Única candidata a construir | **TABA2-PILOT-RC2-CANDIDATE.1**, partiendo del par anterior, integrando sólo Observabilidad y cerrando P0.1–P0.16; G7 puede promover los mismos bits a RC2 |
| `release/taba2-pilot-rc` @ `55093e0` | No es candidata: diverge de la rama físicamente probada, no reproduce el esquema de staging y su propia compra “iPhone” quedó pendiente |
| Producción | No fue tocada ni certificada; Mercado Pago fue TEST, ARCA no llegó a homologación y el Rider usado es un APK staging/debug |

Para este plan, **piloto humano** significa una corrida supervisada en staging, con Mercado Pago TEST, un SKU no alcohólico aprobado, una persona operando el Panel y el Moto físico haciendo un recorrido real. Si se pretende cobrar dinero real o vender a público real, deja de ser piloto de staging y aplican todos los gates de producción.

## 1. Criterio de evidencia

Las declaraciones de los HANDOFF no se tomaron como prueba por sí solas. Se usó esta jerarquía:

1. **Git verificado:** ancestros, SHAs, diferencias, worktrees, remotos y limpieza comprobados directamente.
2. **Artefacto verificable:** log, JSON, captura o APK ligado a una corrida y, cuando existe, a un hash.
3. **Staging histórico:** un HANDOFF documenta una corrida contra staging. Prueba lo ocurrido en ese momento; no prueba el estado actual de un alias mutable.
4. **Declaración reportada:** números de tests o conclusiones que esta auditoría no volvió a ejecutar.
5. **No hecho / contradicho:** el propio reporte lo excluye, otro reporte lo contradice o falta el artefacto final.

Limitaciones deliberadas:

- No se mutó ni se volvió a certificar staging.
- No se ejecutaron nuevamente todas las suites.
- No se tocó producción, Mercado Pago real, Meta ni ARCA.
- “Certificado contra staging” debe leerse como **certificación histórica**, no como garantía del estado vivo al 2026-08-08.

## 2. Estado canónico real

### 2.1 Hay dos repositorios, no una release

**Web/backend/storefront**

- Git común: `C:\Users\marco\dev\la-taba-pages-preview\.git`.
- Remoto: `origin`.
- `origin/main` = `67187e0dfde4fc49b34a2528aa8d99f1698b4d8a`, una demo del 2026-07-01.
- `main` local = `9cd8f8940671b1d8314a6f25abb6ccb4b8247cc4`, 29 commits detrás de `origin/main` y con 35 entradas modificadas/no versionadas.
- Ninguna de las ramas TABA2 auditadas tiene upstream ni aparece contenida en una rama remota.
- No hay tags de release.
- Hay 61 worktrees web registrados; 8 están sucios. Además de `main`, hay trabajo no identificado en worktrees de promos, staging, rediseño y auditoría de migraciones. No hay stashes. Los worktrees candidatos `3d69e6b` y `7cec5a7` sí están limpios.

**Rider Android**

- Git independiente: `D:\1212\la-taba-rider-android\.git`.
- No tiene ningún remoto configurado.
- No hay tag ni manifiesto que lo vincule con el SHA web.

Consecuencia: un SHA web nunca identifica por sí solo “TABA2”. Toda RC debe fijar, como mínimo, el SHA web, el SHA Rider, hashes de APK, migraciones, Edge Functions, configuración y catálogo.

### 2.2 Base canónica de evidencia, no todavía de despliegue

El par de partida correcto es:

```text
web/backend  3d69e6b59cd70e87b4431a99f3875d9c6ab14711
rider        7cec5a70969d851fe37cc82aa2ee2f169f5bce7f
```

Motivo:

- Es el único par asociado a un flujo storefront → Panel → Rider físico → entrega.
- La rama web contiene por ancestro Panel hardening, Tracking, pedidos reales, storefront comercial, combos server-side, Mercado Pago y la cadena principal de catálogo.
- La rama Rider contiene Production RC1, runtime hardening, contratos live, mapa staging, smoke automation, rediseño comercial y correcciones P1.
- Ambos worktrees están limpios.

Pero este par **no es aún una base reproducible**:

- El contrato backend del mapa proviene de `feature/rider-map-location-contracts` @ `898cea6d444e63adeed61f8079cead750036da0c`, una migración SQL ubicada en el repo Rider.
- Staging registra esa migración como `20260804090000_rider_map_location_contracts`.
- El repo web usa la misma versión `20260804090000` para `business_operations_panel` y sólo conserva el mapa como fixture/documento “remote-only”.
- La rama física web agrega después migraciones que alteran esas tablas del mapa. Una base creada únicamente desde el repo web no tiene una fuente canónica completa para ellas.

Por eso la base canónica actual es:

> **Código de referencia:** el par `3d69e6b` / `7cec5a7`.  
> **Datos y despliegue:** no canónicos hasta reconciliar el contrato remote-only con una migración nueva, forward-only y versionada en el repo web.

### 2.3 Staging no es una RC inmutable

Los reportes muestran varias ramas usando la misma base y el mismo alias:

- Pilot Integration aplicó las migraciones de combos y publicó su bundle.
- Pilot RC publicó después otro bundle que ocultaba esos combos, mientras conservaba el esquema de combos en la base.
- Panel hardening aplicó dos migraciones y redesplegó la función de refund.
- Physical E2E aplicó cambios posteriores de coordenadas y pickup.
- Otra sesión ignoró el lock compartido durante una certificación.
- El retorno de Mercado Pago de un deploy inmutable terminó en el dominio principal servido por otra RC.

Una comprobación read-only durante esta auditoría encontró que cinco recursos estáticos del alias actual —incluidos `index.html`, `sw.js` y módulos operativos— coincidían byte a byte con `3d69e6b`; `sw.js` publicaba `la-taba-runtime-v49-borrador-direccion`. Esto identifica la superficie estática, **no** demuestra que DB, Edge Functions, secretos, runtime config y catálogo correspondan al mismo SHA.

## 3. Topología de ramas

### 3.1 Ramas contenidas por la base física web

Estas ramas no deben volver a mergearse:

| Rama | SHA | Estado |
| --- | --- | --- |
| `release/taba2-production-rc1` | `4ca22af6d425` | Ancestro |
| `release/taba2-e2e-test-staging-rc` | `6294a989f67a` | Ancestro |
| `feature/taba2-real-orders-ops` | `aed0293c32d5` | Ancestro |
| `feature/taba2-commercial-storefront` | `6dd05655a491` | Ancestro |
| `feature/taba2-business-panel-hardening` | `c7c3bbd5348b` | Ancestro directo de la línea física |
| `feature/taba2-tracking-visual-polish` | `4ea98c6d0406` | Integrada en la línea física |
| `feature/taba2-commercial-p1-closure` | `b66add06231f` | Ancestro |
| `feature/taba2-unit-catalog-normalization` | `b8ac9a3a5aac` | Ancestro |
| `feature/taba2-retail-unit-publication` | `1c7455029f53` | Ancestro |

Las ramas históricas `feature/taba2-business-operations-final`, `fix/taba2-fiscal-homologation-gate` y `fix/taba2-packing-capacity-unit-fixture` no aparecen como ancestros, pero sus parches fueron portados con otros hashes. No deben mergearse por nombre: primero habría que demostrar un delta semántico todavía ausente.

### 3.2 Trabajo web único o divergente

| Trabajo | Rama @ SHA | Qué es realmente único | Evidencia | Decisión |
| --- | --- | --- | --- | --- |
| Physical E2E | `release/taba2-first-physical-e2e` @ `3d69e6b59cd7` | Coordenadas de checkout, pickup/procedencia, herramientas del primer pedido, integración Panel+Tracking y documentación física | Staging + Moto, con reservas | **Base web** |
| Observabilidad | `feature/taba2-pilot-ops` @ `03c2fbdf4b3b` | 7 commits: 5 migraciones, salud, 18 detectores, traza, panel de piloto, drill de restore | Sólo local | **Integrar primero**, luego certificar staging |
| ARCA | `feature/taba2-arca-fiscal-automation` @ `af93aeb6c753` | 19 commits de circuito fiscal, onboarding y worker | Sólo sintético/local; transporte oficial parcial | **No integrar al piloto** |
| WhatsApp | `feature/taba2-whatsapp-commerce` @ `c1e7cb66d216` | 9 commits: canal, migración, webhook y dispatcher | PostgreSQL local; Meta y MP HTTP simulados | **No integrar al piloto** |
| Stories | `feature/taba2-commercial-stories` @ `27155217f0c1` | 6 commits de Stories, pero arrastra Pilot RC/Fable | Sólo local; persistencia localStorage | **No integrar** |
| Fable visual | `feature/taba2-fable-visual-polish` @ `c761a8d43a9e` | 11 commits visuales/cache ausentes de Physical | Local; incluido en la rama Pilot RC | **Diferir** |
| “Pilot RC” | `release/taba2-pilot-rc` @ `55093e030f3a` | Fable y documentación; diverge desde `6dd0565` | Deploy histórico; compra pendiente | **No usar ni mergear completa** |
| Pilot Integration | `release/taba2-pilot-integration` @ `a8b93cfa4492` | Sólo 2 commits sobre la base ya absorbida: configuración/certificación de alcohol y docs | Staging histórico, MP TEST/WebKit | **No mergear completa** |
| Shelf Stage 1 | `feature/taba2-commercial-shelf-stage1` @ `9cc051af1712` | 2 commits de orden de góndola y recomendaciones | Sólo local; datos insuficientes | **Esperar datos de Walter** |
| MP staging RC1 | `release/taba2-mercadopago-staging-rc1` @ `0587712be87b` | Línea vieja; ancestro de payment recovery | Staging TEST histórico | **No mergear** |
| Payment recovery | `fix/taba2-p0-payment-recovery-ux` @ `3e48bb0bcd77` | Mayormente portado; `83dc8e2` no es patch-equivalent | Línea vieja, 16 conflictos textuales con Physical | **Auditar el delta, no mergear** |

Ramas únicas encontradas sin un HANDOFF suficiente dentro del tren solicitado:

- `feature/taba2-arca-homologation-readiness` @ `13936d5eedd3`.
- `feature/catalog-expansion-argentina` @ `67aa86d53be6`.
- `feature/taba2-beverage-catalog-home` @ `3e1f90d3a60a`.
- `fix/taba2-mobile-layout-hardening` @ `fd87c1ac1642`.

Son trabajo potencialmente válido, pero **trabajo sin reporte no entra a una RC por descubrimiento accidental**. Quedan en cuarentena para una auditoría de delta separada.

### 3.3 Rider Android

`release/taba2-rider-first-physical-e2e` @ `7cec5a70969d` contiene:

- `fix/rider-android-runtime-hardening` @ `434c4d5`.
- `feature/rider-pilot-readiness-ux` @ `db645b5`.
- `feature/rider-live-contract-integration` @ `f1f3f37`.
- `release/taba2-rider-production-rc1` @ `214d2b4`.
- `codex/rider-map-staging` @ `95294d9`.
- `test/taba2-rider-staging-smoke-automation` @ `8e2b671`.
- `feature/taba2-rider-commercial-redesign` @ `d1ce78e`.
- `fix/taba2-rider-commercial-review-p1` @ `9b498db`.

La excepción topológica es `feature/rider-map-location-contracts` @ `898cea6d`. No contiene Flutter: contiene el contrato SQL del mapa ya aplicado externamente a staging. **No debe mergearse al APK ni reejecutarse con su versión original.** Debe conservarse como procedencia y canonizarse en el repo web con una versión nueva.

## 4. Matriz de certificación real

| Área | Local | Staging histórico | Hardware real | Proveedor/homologación | Veredicto |
| --- | --- | --- | --- | --- | --- |
| Pedidos/stock/Panel | Suites y contratos reportados | 47/47, circuito LT-0084 y smoke de UI real | Panel en navegador, no hardware especial | No aplica | Fuerte para staging; debe repetirse sobre RC2 |
| Mercado Pago | Webhook, lifecycle y recovery reportados | Pagos TEST aprobados y finalizados | Cliente fue navegador emulado | Proveedor TEST; webhook automático no quedó demostrado | Componente TEST ejercitado; repetir recuperación automática sobre RC2; producción no |
| Tracking visual | 1095 unit y 206 E2E reportados | Luego ejercitado por Physical | Moto muestra mapa; cliente web | GPS real estacionario | Presentación contenida; movimiento no certificado |
| Rider Android | Analyze/unit/instrumentation reportados | Contratos y pedidos de staging | Moto G15, Android 15, ADB, APK instalada | Sólo Wi‑Fi; sin SIM | Hardware parcial, no corrida humana |
| Physical E2E | Harness + artefactos | Storefront, Panel y backend staging | Moto real | MP TEST; navegador cliente sintético | Mejor evidencia integrada, pero no final limpia |
| Observabilidad | 1152 tests, DB local, restore drill | **No ejecutado** | No aplica | Backups hosted no auditados | Sólo local |
| ARCA | 1126 unit, 81 fiscal, 222 aserciones DB reportadas | **No desplegado** | No aplica | FEDummy 200; certificado autofirmado rechazado; sin TA/CAE | Sintético, no homologado |
| WhatsApp | 1195 Node, canal y DB local reportados | **No desplegado** | Sin teléfono/número Meta | Graph API y MP HTTP simulados | Sintético |
| Stories | 1089/215 reportados y visual local | **No desplegado** | Navegadores emulados | No aplica | Demo local, no operación compartida |
| Catálogo/shelf | Validadores y UI local | Parte del storefront llegó a staging en otras ramas | No aplica | Datos comerciales no confirmados | Software parcial; negocio no listo |

### 4.1 Lo certificado sólo localmente

- Observabilidad/Pilot Ops.
- ARCA automation y onboarding fiscal.
- WhatsApp Commerce.
- Stories.
- Tracking visual en su rama original; su comportamiento luego fue parcialmente ejercitado en Physical.
- Shelf Stage 1 y los reportes de catálogo/comercial.
- Fable visual.

### 4.2 Lo históricamente certificado contra staging

- Pedidos reales y contratos 47/47.
- Panel hardening, incluida UI real contra staging.
- Combos y Mercado Pago TEST de Pilot Integration.
- Flujo de Physical E2E con storefront, Panel y Rider.
- Coordenadas, pickup provisional y tracking del pedido.

No están certificados contra staging:

- Las cinco migraciones de Observabilidad.
- ARCA.
- WhatsApp.
- Stories.
- El estado combinado que propone RC2.

### 4.3 Lo probado en hardware real

Sí:

- Moto G15, Android 15, identificado por ADB.
- APK staging instalada y comparada por hash en las sesiones reportadas.
- Login, cola, privacidad pre/post claim, claim, retiro, salida, llegada, código, mapa, apertura de Google Maps, pantalla apagada, background/foreground y corte de red con la app viva.
- GPS del dispositivo publicando desde Wi‑Fi.

No:

- iPhone físico del cliente. “iPhone real” en los reportes corresponde a WebKit con descriptor/contexto de iPhone.
- Desplazamiento físico del Rider: el Moto permaneció quieto.
- Datos móviles: el Moto no tiene SIM y no registró tráfico celular.
- Cold start sin red: está medido como roto.
- Punto de retiro verificado por presencia humana.
- Corrida limpia del arnés después del commit final `7cec5a7`.

### 4.4 Sintético, sandbox u homologación incompleta

- Mercado Pago: entorno TEST y tarjetas de prueba; sí habló con el proveedor, pero no movió dinero real.
- ARCA: fixtures fieles y contacto real sólo con FEDummy/WSAA rechazado; no hubo certificado oficial, Ticket de Acceso, CAE ni comprobante.
- WhatsApp: PostgreSQL real local; Graph API de Meta y MP HTTP simulados; sin app, número, secretos, webhook suscrito ni plantillas.
- Stories: estado y métricas en `localStorage` del dispositivo; Panel sandbox, no productivo.
- Catálogo: precios, stock, GTIN, imágenes y políticas mezclan datos demo, pendientes y valores no confirmados.
- Buyer/client de Physical: Chromium mobile viewport con geolocalización fijada, no un teléfono físico.

## 5. Contradicciones y evidencia faltante

### C1. “Pilot RC” no fue la rama probada físicamente

`release/taba2-pilot-rc` y `release/taba2-first-physical-e2e` divergen desde `6dd05655a491`. Pilot RC tiene trabajo Fable exclusivo; Physical tiene Panel, Tracking, coordenadas, pickup y arnés físico exclusivos. Probar Physical no certifica el árbol llamado Pilot RC.

### C2. La compra “iPhone real” no fue en iPhone real

- Pilot RC deja la compra pendiente tras 40 minutos sin checkout.
- Pilot Integration documenta LT-0086 en WebKit con forma/descriptor de iPhone.
- Panel hardening la vuelve a nombrar “iPhone real”.

Conclusión: hubo compra real contra Mercado Pago TEST desde un navegador emulado; no hubo prueba en hardware iOS.

### C3. Staging mezcla fuente, esquema y bundle

Pilot RC reconoce que corrió 47/47 contra migraciones de combos ausentes de su rama. El alias web fue sobrescrito entre RCs. El retorno de MP saltó de un deploy inmutable al dominio principal de otra RC. El lock fue ignorado por otra sesión. Ningún reporte prueba un snapshot aislado y reproducible de todo el entorno.

### C4. La evidencia física final no es un paquete limpio

El bundle tiene 175 archivos y evidencia sustantiva, pero también contiene:

- `rider-lt0098/matriz.json` con `FALLA` en confirmar retiro.
- Logs con `FINAL_STATE_MISMATCH` y `FAILURES!!!`.
- Un HANDOFF posterior que explica cuatro falsos negativos del arnés.
- El commit final del arnés `7cec5a7` es posterior a los últimos checkpoints.
- Tres hashes de APK distintos en el mismo HANDOFF y ningún manifiesto que determine cuál representa toda la declaración final.
- `pedido-humano/monitor.json` conserva `alertas` e `historia` vacíos: el primer pedido humano no ocurrió.

Esto no demuestra que el producto fallara; demuestra que **no existe una corrida final, limpia y archivada sobre el head final**. Debe repetirse.

### C5. “GPS vivo” no significa “reparto en movimiento”

El JSON medido muestra cadencia aproximada de 12,4 s y baja latencia al backend, pero los saltos fueron del orden de centímetros/metros y el propio HANDOFF dice que el equipo estaba quieto. No hay evidencia de ruta, cambio de celdas, calle ni datos móviles.

### C6. El pickup no está validado

El candidato fue inferido por directorio público. El reverse geocoding devuelve Diagonal España y el punto permanece `human_verified=false`. Google Maps no lo reconoce como “La Taba 2, Mendoza 827”. Debe verificarse parado en la puerta.

### C7. El arranque en frío offline está roto

Con proceso reiniciado y sin red, la app muestra que no hay pedidos aunque exista una entrega activa. El reporte lo minimiza como un caso poco frecuente. Android puede matar procesos en background; para un piloto humano es P0.

### C8. “Observabilidad certificada” excluye staging y backups hosted

El drill local es valioso y reporta equivalencia de 69 tablas, pero no prueba que Supabase tenga backup, retención, PITR ni un operador autorizado para restaurar. Tampoco prueba las cinco migraciones sobre el esquema vivo actual.

### C9. ARCA y WhatsApp usan la palabra “certificado” con alcance sintético

ARCA declara correctamente que homologación no ocurrió. WhatsApp declara un test flow sobre providers simulados y además no corrió la suite web completa. Ninguno debe entrar a un piloto por el nombre de su declaración final.

### C10. Los números del catálogo no convergen

Distintos cortes reportan:

- 82 productos y 20 comprables.
- 82 productos y 11 comprables.
- 92 registros, 80 visibles, 11 comprables y 96 pendientes de distinta clase.

No necesariamente son errores: son ramas/datasets distintos. Pero impiden declarar una cifra comercial vigente. La RC debe generar un snapshot nuevo desde la base y el catálogo exactos que se van a demostrar.

### C11. La cadena de migraciones no tiene autoridad única

Hay tres problemas distintos:

1. `20260804090000` significa mapa Rider en staging y Panel en el repo web.
2. Ops y ARCA reutilizan `20260807110000` a `20260807150000` para SQL completamente diferente.
3. Physical usa `20260807170000_pickup_point_provenance` y WhatsApp usa `20260807170000_whatsapp_commerce_channel`.

Un merge textual limpio no resuelve esto: Supabase identifica la migración por versión y puede saltear una de las dos. Toda rama diferida debe renumerarse de forma forward-only antes de entrar.

### C12. La release sólo vive localmente

Las ramas web no están en el remoto, Rider no tiene remoto, no hay tags y los workflows de CI no corrieron sobre los HEAD locales finales. Una falla de disco o una limpieza de worktrees puede eliminar la única copia de la evidencia y del código.

### C13. Un gate 47/47 ya dio un falso sentido de seguridad

Panel hardening encontró que las transiciones de la UI no funcionaban aunque la certificación RPC estuviera verde: las claves de idempotencia del navegador no cumplían el contrato y el Rider web llamaba RPC obsoletos. Por eso RC2 exige pruebas por la UI y hardware además de sondas directas; ningún número de RPC, por alto que sea, certifica la interfaz.

## 6. Qué falta para piloto humano

### P0 — bloquea el piloto

| P0 | Cierre exigido | Evidencia de salida |
| --- | --- | --- |
| P0.1 Preservar el código | Publicar ramas/tags web; crear remoto Rider o, como mínimo inmediato, bundles verificados en almacenamiento externo | URLs/IDs remotos, tags inmutables, hashes de bundles |
| P0.2 Canonizar el esquema del mapa | Incorporar al repo web una migración nueva que reconcilie el contrato remote-only sin reutilizar `20260804090000`; probar base limpia, estado parcial y clon restaurado del staging exacto | Replay desde cero y upgrade realista sobre clon, ambos verdes |
| P0.3 Integrar Observabilidad | Merge controlado de `03c2fbdf` sobre `3d69e6b`; nunca ARCA a la vez | Merge auditado y gates G0–G2 |
| P0.4 Resolver historial/ACL | Conservar una sola corrección de `20260806160000`; verificar que `anon` no ejecute RPC Rider tanto en clean DB como en staging; si falla, usar nueva migración forward-only | Sondas de ACL con resultado explícito |
| P0.5 Staging inmutable | Ventana exclusiva real, deploy por SHA, config digest, Edge hashes, lista de migraciones y un solo checkout base URL | Manifiesto de entorno; cero mutaciones concurrentes |
| P0.6 Backups hosted | Confirmar backup habilitado, frecuencia, retención, PITR, último éxito y quién restaura; ensayar restore sin pisar staging | Evidencia del proveedor + drill |
| P0.7 Rider reproducible | Rebuild limpio desde el head candidato; archivar APK y test APK; instalar exactamente ese hash | Hash local = hash extraído del Moto |
| P0.8 Cerrar cold-start offline | La entrega activa reaparece tras matar proceso sin red y concilia exactamente una vez al volver | Test automatizado + Moto real |
| P0.9 Movimiento y conectividad | Declarar el modo: SIM nativa o piloto hotspot-only. Hacer recorrido seguro multipunto, pantalla apagada y pérdida/retorno del transporte elegido | Ruta plausible ≥300 m/5 min/20 puntos, cadencia y exactly-once; sin confundir deriva con movimiento |
| P0.10 Verificar pickup | Medición parado en la puerta, tolerancia/precisión documentadas, actualización auditada a origen humano | `human_verified=true` y Maps/Panel/Rider consistentes |
| P0.11 Fijar surtido del piloto | Walter aprueba al menos un SKU no alcohólico, precio, stock, envío, mínimo, horario y cobertura; alcohol deshabilitado | Snapshot comercial firmado y digest |
| P0.12 Repetir E2E final | Storefront del candidato, Panel por UI, Moto con arnés final, MP TEST, wrong/right code y observabilidad | Bundle nuevo sin fallos ni explicaciones retrospectivas |
| P0.13 Ejecutar CI exacto | CI web y Rider sobre los dos HEAD; matrices y artefactos asociados a esos SHAs | Runs remotos verdes y descargables |
| P0.14 Privacidad previa | Antes de clonar staging o capturar nueva dirección/GPS: base/autorización para tratar datos existentes y consentimiento de toda persona que participe en pruebas de ubicación; minimización, acceso, cifrado, retención y eliminación definidos | Acta de autorización/consentimiento y plan de datos aprobado antes del primer clon o recorrido |
| P0.15 Proteger evidencia | Antes de exportar o clonar: sanear la copia compartida, restringir y cifrar originales/clones que contengan códigos de entrega, coordenadas precisas, credenciales o PII, y registrar destrucción programada | Scan, ACL/cifrado y dueño de borrado del almacenamiento |
| P0.16 Ensayar rollback completo | Rollback web, Edge, DB compatible, callbacks pendientes, APK rollback y reapertura sobre clon/entorno sacrificable | Acta G6R con hashes y tiempos |
| P0.17 Ensayo humano supervisado | Una corrida sobre el candidato ya congelado, con responsables, cronómetro y monitor | Acta PILOT-GO/NO-GO y reconciliación final |

No se acepta “waiver” para P0.8 por mantener la app abierta: la decisión de matar procesos pertenece a Android, no al operador.

P0.14 y P0.15 son prerequisitos tempranos: bloquean cualquier clon con filas de staging y cualquier captura física/GPS, no pueden postergarse al freeze. P0.1–P0.16 bloquean el freeze de `TABA2-PILOT-RC2-CANDIDATE.1`. P0.17 es el gate de promoción: no cambia un byte; sólo permite etiquetar el mismo manifiesto como `TABA2-PILOT-RC2`.

### P1 — no bloquea el piloto de staging, sí producción

- Mercado Pago live: credenciales productivas, allowlist, firma de webhook, pago real de bajo monto, devolución, conciliación y procedimiento de chargeback.
- ARCA: certificado oficial de homologación, TA, CAE de homologación, caso fiscal aprobado por titular/contador, bridge desplegado en red privada y gate de producción.
- APK Rider firmado/release, CI reproducible, distribución controlada, versionCode y rollback instalable.
- Transición nativa Wi‑Fi ↔ datos móviles y operación de calle en el dispositivo final; un piloto hotspot-only no certifica este punto.
- Auditoría de seguridad/RLS/roles sobre el candidato, incluida privacidad de coordenadas y datos fiscales.
- Carga/performance/capacidad y degradación de servicios externos.
- Política legal/comercial definitiva: alcohol, edad, ventanas, comprobantes, privacidad, retención y soporte.
- Catálogo operativo: precios/stock reales, duplicados resueltos, imágenes con derechos, GTIN cuando sea requerido, horarios y cobertura.
- Alertas con destino humano, guardias, umbrales aprobados y simulacro de incidente.
- Cobertura PWA/offline: hoy parte de los módulos queda fuera del precache.

### P2 — expansión posterior

- WhatsApp productivo y plantillas fuera de ventana de 24 h.
- Stories con backend compartido, Panel productivo, autorización y atribución de compra server-side.
- Fable y otras mejoras visuales una vez congelado el circuito funcional.
- Shelf completo, recomendaciones, catálogo ampliado y surtido de 25–30 productos.
- Analítica comercial histórica de stock y conversión.
- Optimización de tracking, batería y operación multi-rider a escala.

## 7. Qué NO integrar todavía

| Rama/cambio | Motivo |
| --- | --- |
| `release/taba2-pilot-rc` completa | Árbol viejo y divergente; reintroduce 7 conflictos textuales y no incluye la línea física |
| Fable visual | Cambia assets/cache y obligaría a repetir la evidencia física sin aportar un requisito P0 |
| Stories | 8 conflictos textuales con Physical; localStorage, Panel sandbox, sin backend ni autorización productiva |
| ARCA automation | Sin homologación/staging; colisiona en cinco números de migración con Ops |
| WhatsApp Commerce | Sin Meta real/staging; colisiona `20260807170000` con Pickup; suite web completa no corrida |
| Shelf Stage 1 | No hay precio/stock para el surtido pedido; integrar UI sin datos no habilita venta |
| MP staging RC1 o payment recovery completas | Línea muy antigua, 16 conflictos textuales; casi todo está portado y sólo queda un delta puntual por auditar |
| `release/taba2-pilot-integration` completa | El core ya está absorbido; quedan política de alcohol de staging y documentación, no una base de código necesaria |
| `898cea6d` dentro del repo Rider | Es backend SQL ya aplicado con versión colisionada; no modifica el APK |
| Cualquier rama sin HANDOFF suficiente | No hay base para juzgar alcance, gates o regresiones |
| `main` o worktrees sucios | Contienen trabajo ajeno/no identificado; no son bases de integración |

Para el piloto, se usa un SKU no alcohólico. La política de alcohol no se hereda de staging como decisión del negocio.

## 8. Orden exacto de integración

### Fase A — preservar y congelar

1. Declarar freeze de staging y de las dos ramas base.
2. Cerrar P0.14/P0.15 **antes de copiar filas, clonar staging o generar una nueva traza GPS**: autorización/consentimiento aplicable, minimización, ACL, cifrado, retención, borrado y responsable. Una inspección read-only de metadatos puede precederlo; ninguna exportación de PII puede hacerlo.
3. Registrar hashes de todos los HEAD y artefactos existentes.
4. Crear tags de auditoría locales.
5. Publicar el repo web y establecer un remoto Rider. Si el remoto Rider requiere una decisión de propiedad, crear antes un `git bundle` verificado fuera de `D:\1212`.
6. Capturar del staging actual, en modo read-only y sin exportar filas sensibles:
   - historial de migraciones;
   - definiciones/hashes de RPCs y tablas del mapa;
   - ACL;
   - Edge Functions y configuración;
   - deployment ID/commit servido;
   - catálogo y flags.

**Gate:** G0. Si no puede reconstruirse la procedencia, no se crea la rama RC.

### Fase B — worktrees limpios

Usar worktrees nuevos; nunca `main`:

```powershell
git -C C:\Users\marco\dev\la-taba-pages-preview worktree add `
  -b release/taba2-pilot-rc2 `
  D:\1212\worktrees\taba2-pilot-rc2-web `
  3d69e6b59cd70e87b4431a99f3875d9c6ab14711

git -C D:\1212\la-taba-rider-android worktree add `
  -b release/taba2-rider-pilot-rc2 `
  D:\1212\worktrees\taba2-rider-pilot-rc2 `
  7cec5a70969d851fe37cc82aa2ee2f169f5bce7f
```

No mergear Panel, Tracking, storefront, real-orders ni catálogo base: son ancestros. Documentar los `merge-base --is-ancestor` como no-op.

**Gate:** G0 + G1 de baseline. Si la base no vuelve a pasar, detenerse antes de sumar cambios.

### Fase C — única integración de rama para el piloto

Integrar `feature/taba2-pilot-ops` @ `03c2fbdf4b3b`:

```powershell
git merge --no-ff --no-commit feature/taba2-pilot-ops
```

La comparación desde el merge-base `c7c3bbd` muestra cero archivos modificados por ambos deltas, por lo que no se espera conflicto textual. Aun así hay riesgos semánticos:

- edición histórica de `20260806160000`;
- cinco migraciones que en staging se aplicarían fuera del orden temporal ya registrado;
- ACL de `get_rider_queue`;
- dependencias del Panel y del catálogo;
- configuración de thresholds y alertas.

Revisar el índice completo antes de confirmar el merge. Mantener un merge commit `--no-ff` para conservar procedencia. No rebasear después de certificar.

**Gate:** G0 + G1. Ante cualquier falla, abortar el merge; no apilar otro feature.

### Fase D — autoridad de migraciones

Después del merge de Ops y antes de cualquier deploy:

1. Comparar el SQL de procedencia `898cea6d` con las definiciones read-only del staging; no asumir que son idénticos.
2. Canonizar el contrato remote-only en el repo web mediante una migración nueva, idempotente y fail-closed.
3. La versión nueva debe ordenar **después** de la última migración de Ops (`20260807150000`) y **antes** de las primeras migraciones físicas que dependen del mapa (`20260807160000`/`20260807170000`). Una candidata es `20260807155000`, sólo si el inventario global confirma que está libre.
4. En una base limpia debe crear el contrato. En staging, donde ya existe, debe validar y ser no-op. Un estado parcial debe abortar antes de mutar.
5. Conservar la historia remota `20260804090000_rider_map_location_contracts` sin renombrarla ni intentar reejecutarla.
6. Como staging ya registra versiones posteriores, aplicar esta reconciliación fuera de orden sólo con el mecanismo explícito de inclusión de migraciones antiguas, listado de pendientes revisado y backup previo.
7. Verificar que toda la cadena, incluidas `20260807160000` y `20260807170000`, funcione desde cero sin fixtures remote-only.
8. Sólo con P0.14/P0.15 ya cerrados, restaurar un snapshot exacto y reciente de staging en un proyecto/clúster aislado, cifrado y de acceso restringido; ejecutar allí el mismo comando, flags y orden que se usarían en staging; comparar esquema, historial, filas críticas minimizadas y ACL antes/después, y destruir el clon según el plazo aprobado.

Esto requiere implementación posterior, pero queda ordenado aquí porque sin esta reconciliación no existe una RC reproducible.

**Gate:** G0 + G1 + G2 completos sobre el nuevo HEAD. No se permite compensar con fixtures de test ni copiar la migración vieja bajo su versión colisionada.

### Fase E — correcciones P0 del Rider

Partir de `7cec5a7` y hacer únicamente el cambio necesario para recuperar la entrega activa en cold start offline, con su prueba. No traer `898cea6d` al APK.

Luego reconstruir desde checkout limpio y archivar:

- APK de producto;
- APK de instrumentation;
- mapping/símbolos aplicables;
- SHA-256;
- commit, toolchain, flavor, applicationId, versionName/versionCode;
- firma/certificado público;
- configuración de staging sin secretos.

**Gate:** porción de procedencia/higiene de G0 aplicada al repo Rider + G4.

### Fase F — staging del candidato

**Precondición:** los HEAD exactos que se desplegarán ya pasaron G0–G4; un cambio posterior invalida esos resultados.

1. Tomar una ventana exclusiva mediante control de entorno/CI, no sólo un archivo de lock.
2. Capturar backup y baseline.
3. Confirmar que el upgrade idéntico ya pasó sobre el clon exacto de staging.
4. Aplicar las migraciones exactas del candidato.
5. Desplegar Edge Functions exactas.
6. Publicar Pages a un deployment inmutable cuyo source SHA sea el candidato.
7. Configurar `TABA_CHECKOUT_BASE_URL` y allowed origins al mismo origen.
8. Generar el manifiesto del entorno.
9. Ejecutar G3.

No se usa el alias compartido para certificar hasta que el deploy inmutable esté verde. Recién entonces el alias puede apuntar a ese deployment.

### Fase G — hardware y piloto

1. Verificar que P0.14/P0.15 siguen cerrados para las personas, el dispositivo y el almacenamiento concretos; si no, detenerse antes de G5.
2. Instalar el APK exacto en el Moto y volver a extraerlo para comparar hash.
3. Ejecutar G5 con el transporte declarado y movimiento real.
4. Ejecutar G6R: rollback completo y restauración del candidato sobre un entorno sacrificable, incluidos callbacks y APK. En el único Moto disponible, volver al candidato mediante **desinstalación del APK rollback e instalación limpia del APK candidato original**, seguida de login, verificación de hash, rehidratación/reconciliación y smoke; Android no aceptará instalarlo encima del rollback de `versionCode` mayor.
5. Cerrar los P0 restantes: P0.1–P0.13 y P0.16; P0.14/P0.15 debieron cerrarse antes del clon/GPS.
6. Ejecutar G6C: completar el manifiesto sin `TBD`, congelar SHAs/artefactos/deployment y etiquetar **`TABA2-PILOT-RC2-CANDIDATE.1`**.
7. Ejecutar G7: corrida humana supervisada sobre ese candidato inmutable, con MP TEST y SKU no alcohólico.
8. Reconciliar pedido, pago, stock, reservas, outboxes, eventos y alertas.
9. Si G7 queda verde, promover **los mismos hashes** a **`TABA2-PILOT-RC2`** y emitir `PILOT-GO`. Si cambia un byte o falla un gate, crear `CANDIDATE.2`; nunca corregir el candidato en sitio.

### Orden posterior al piloto

No apilar estas ramas sobre RC2 de una vez. Cada una vuelve a empezar desde el último tag verde:

1. Congelar datos comerciales reales y endurecer Mercado Pago producción; no mergear la rama MP vieja.
2. ARCA, después de homologación; renumerar sus cinco migraciones por encima del máximo vigente y resolver su solapamiento con Ops.
3. WhatsApp, después de Meta oficial; excluir el cherry-pick duplicado de `20260806160000` y renumerar su migración.
4. Fable como delta visual curado, no mediante merge de Pilot RC.
5. Shelf, después de recibir datos.
6. Stories reconstruida sobre la base nueva y con persistencia/backend productivo.

Cada feature debe tener su propia RC y su propio rollback. Un solo “mega-merge” anularía la evidencia disponible.

## 9. Gates obligatorios

### G0 — procedencia e higiene

- P0.14/P0.15 cerrados antes de copiar filas, restaurar clones o capturar nuevas coordenadas; metadatos read-only no habilitan exportar PII.
- Worktree limpio.
- HEAD y padres registrados.
- Cero archivos no versionados inesperados.
- Ancestros verificados.
- Rama remota/tag de respaldo disponibles.
- `git diff --check`.
- Scan de secretos.
- Inventario de migraciones sin versiones duplicadas.
- Diff completo revisado por release manager.

### G1 — código web local

- `npm run check`.
- `npm test`.
- `npm run test:e2e` con host y puertos exclusivos.
- `npm run test:webhook`.
- `npm run secrets:scan`.
- `npm run migrations:validate`.
- Chromium, Firefox y auditoría WebKit/superficies.
- Cero reducción silenciosa del número de tests respecto del parent; cualquier cambio se explica por diff.
- Service worker: un solo `CACHE_NAME`, assets existentes, HTML/CSS/JS versionados juntos y prueba de upgrade desde la versión previa.

### G2 — base de datos y recuperación

- Replay de todas las migraciones sobre PostgreSQL vacío sin fixtures remote-only.
- Simulación del staging histórico colisionado.
- Restore de un snapshot exacto de staging en un clon aislado y ejecución del mismo upgrade retroactivo, con el mismo comando/flags/orden previstos para staging.
- Diff de esquema, historial, ACL y conteos críticos del clon antes/después; las únicas diferencias son las aprobadas.
- Estado parcial debe abortar antes de mutar.
- Cero número de migración duplicado con SQL distinto.
- Sondas RLS/ACL para `anon`, `authenticated`, rider, staff, admin y owner.
- `get_rider_queue` y coordenadas: privacidad pre-claim/post-claim.
- Tests de pagos, combos, órdenes, stock, outboxes y exactly-once.
- `npm run pilot:ops:drill`.
- Dump/restore y equivalencia de datos/esquema.
- Plan forward-only; no down migrations destructivas.

### G3 — staging sobre SHA inmutable

- Deployment source SHA = manifest.
- Runtime config digest = manifest.
- Edge Function hashes = manifest.
- Lista/hash de migraciones = manifest.
- `certify:orders:staging` sin fallos.
- Circuito fresco de pedido completo.
- Smoke de Panel por UI: login, bandeja, transiciones, reload, offline/reconexión, doble click.
- MP TEST, caso normal: preferencia y retorno por UI, sin scripts/manual service role; pedido único y monto exacto.
- MP TEST, recuperación: cerrar el browser después de aprobar y demostrar que webhook/worker reconcilia automáticamente dentro del SLA fijado.
- Callbacks de pago duplicados, demorados y fuera de orden convergen una sola vez; polling y webhook pueden competir sin duplicar.
- Observabilidad: ocho servicios con evidencia, alertas sintéticas, traza PII-free y reporte.
- Cero pagos aprobados sin pedido, reservas huérfanas, outboxes atascadas o eventos sin tipo.
- Anon no accede a contratos Rider/fiscales.
- No hubo otra mutación durante toda la ventana.

### G4 — build Rider

- Toolchain fijado.
- Analyze, unit, JVM y tests Android verdes.
- Build limpio, no reutilización de `build/`.
- APK producto y test archivadas.
- Firma, flavor y applicationId correctos.
- Hash instalado = hash archivado.
- Clean install y upgrade desde la versión previa.

### G5 — Moto físico

- P0.14/P0.15 cerrados y revalidados antes de iniciar la captura; consentimiento/plan no se completa retrospectivamente.
- Login y sesión tras cold start.
- Cola y privacidad antes/después de claim.
- Doble claim no-op.
- Pickup, salida, navegación externa y regreso.
- Transporte declarado en el manifiesto: SIM nativa o hotspot-only. Si es hotspot, no se afirma handover celular del Moto.
- Ruta segura ≥300 m y ≥5 min, con ≥20 puntos aceptados, traza compatible con calles/tiempos y desplazamiento mayor que la incertidumbre; dos fixes aislados no alcanzan.
- Cadencia/latencia/frescura dentro de umbrales fijados antes de correr; sin saltos físicamente imposibles.
- Pantalla apagada/background.
- Corte de red y cola offline.
- Kill del proceso sin red; la entrega activa sigue visible.
- Recuperación de red y exactly-once.
- Tracking del cliente fresco.
- Código incorrecto rechazado; correcto entrega una sola vez.
- Reporte final sin `FAILURES!!!` ni una explicación manual para convertir rojo en verde.

### G6R — rollback completo

- Clon/entorno sacrificable con el mismo esquema y artefactos del candidato.
- Pausa de admisión verificada: bloquea checkouts nuevos sin cortar callbacks pendientes.
- Repoint del alias web y rollback de Edge al artefacto anterior.
- Compatibilidad del esquema forward-only; no se deshacen migraciones.
- Un pago TEST aprobado y pendiente termina/reconcilia durante el rollback sin duplicarse.
- APK rollback construida desde el source anterior, con misma firma y `versionCode` instalable superior; pasa G4 y el smoke crítico de G5.
- En el Moto único, restaurar luego **los bits originales** del candidato mediante desinstalación del rollback e instalación limpia del APK candidato archivado; no recompilar ni elevar su `versionCode`.
- Verificar hash, iniciar sesión, rehidratar/reconciliar el estado servidor, reabrir y repetir el smoke. Documentar que los datos locales se pierden al desinstalar y que el flujo se recupera desde estado durable.
- Tiempos, hashes, órdenes y resultado archivados.

### G6C — freeze del candidato

- P0.1–P0.16 cerrados.
- Web y Rider pusheados.
- Tag inmutable `TABA2-PILOT-RC2-CANDIDATE.N`.
- Artefactos en almacenamiento externo.
- Manifiesto sin `TBD`.
- Deployment/alias, rollback y changelog fijados.
- Desde este punto no cambia un byte; una corrección crea `CANDIDATE.N+1`.

### G7 — ensayo humano y promoción

- Walter/negocio confirma pickup y datos comerciales.
- Participante informado: consentimiento, acceso, retención y eliminación definidos antes de capturar dirección/GPS.
- Cliente humano usa el storefront del candidato inmutable.
- Operador humano usa el Panel.
- Rider humano lleva el Moto.
- MP TEST claramente identificado.
- Monitor y responsables activos.
- Rollback G6R ya ejecutado, no sólo documentado.
- Evidencia temporal correlacionada por pedido.
- Copia compartida de evidencia saneada; original restringido.
- Acta PILOT-GO/NO-GO firmada.
- Si queda verde, el mismo manifiesto se etiqueta `TABA2-PILOT-RC2`; no se recompila ni redespliega para promover.

## 10. Única RC candidata

No se designa una rama existente. Se reserva:

**TABA2-PILOT-RC2-CANDIDATE.1**

```yaml
name: TABA2-PILOT-RC2-CANDIDATE.1
promotion_name: TABA2-PILOT-RC2
scope: supervised-staging-human-pilot
web_parent: 3d69e6b59cd70e87b4431a99f3875d9c6ab14711
required_ops_parent: 03c2fbdf4b3b
rider_parent: 7cec5a70969d851fe37cc82aa2ee2f169f5bce7f
web_sha: TBD
rider_sha: TBD
web_deploy_id: TBD
runtime_config_sha256: TBD
edge_functions_sha256: TBD
migration_manifest_sha256: TBD
catalog_snapshot_sha256: TBD
rider_apk_sha256: TBD
rider_test_apk_sha256: TBD
evidence_bundle_sha256: TBD
privacy_plan_sha256: TBD
connectivity_mode: TBD
rollback_web_deploy_id: TBD
rollback_edge_functions_sha256: TBD
rollback_rider_apk_sha256: TBD
rollback_drill_evidence_sha256: TBD
```

Mientras haya un `TBD` o siga abierto P0.1–P0.16, el nombre es sólo una plantilla. G6C congela el candidato completo. G7 puede promover **ese mismo manifiesto** a `TABA2-PILOT-RC2`; no genera otro build.

La pareja `3d69e6b` / `7cec5a7` es la base más cercana, pero no debe renombrarse retroactivamente como candidata: todavía carece de Observabilidad en staging, esquema reproducible, cold-start offline, recorrido real con transporte declarado, pickup humano y corrida final limpia.

## 11. Plan de rollback

### 11.1 Preparación previa

- Registrar el deployment web inmutable anterior.
- Archivar las Edge Functions anteriores y sus hashes.
- Capturar backup/PITR y probar que puede restaurarse en un proyecto separado.
- Preparar un APK rollback desde el source anterior, con la misma firma y `versionCode` superior al candidato, porque Android puede bloquear un downgrade. Es un artefacto nuevo: debe pasar G4 y el smoke crítico de G5 antes del piloto.
- Archivar también el APK candidato original y ensayar el regreso en el Moto: desinstalar el rollback, instalar limpiamente ese mismo APK candidato, comprobar su hash, iniciar sesión y recuperar/reconciliar el estado durable. No crear otro build para volver al candidato.
- Probar —no asumir— cómo pausar nuevas órdenes sin cortar webhooks ni reconciliación de pagos ya iniciados. Si el estado del negocio no bloquea checkout, el fallback es un bundle de mantenimiento ya archivado.
- Mantener migraciones backward-compatible durante el piloto.

### 11.2 Disparadores de rollback inmediato

- Dos pedidos para una intención.
- Pago aprobado sin pedido o monto inconsistente.
- Pérdida/duplicación de stock o reserva.
- Acceso anónimo/no autorizado a cola, coordenadas o fiscal.
- Panel sin intake/transiciones.
- Rider pierde una entrega activa.
- Migración parcial o historial incoherente.
- Alertas/telemetría ciegas.
- Error sostenido que impide completar el único flujo del piloto.

### 11.3 Secuencia

1. **Cerrar admisión:** pausar el negocio o publicar mantenimiento, verificando que no nazcan nuevos checkouts.
2. **No cortar callbacks:** mantener webhook/status/reconciliación para pagos ya iniciados.
3. **Preservar evidencia:** snapshot de órdenes, pagos, stock, reservas, outboxes, eventos, logs y correlation IDs.
4. **Web:** repuntar el alias al deployment inmutable previo.
5. **Edge:** redesplegar artefactos previos si el incidente está allí.
6. **Rider:** instalar el APK rollback preparado; no improvisar un downgrade.
7. **DB:** no borrar ni bajar migraciones. Desactivar la superficie nueva por flag/config y, si hace falta, aplicar una migración compensatoria forward-only.
8. **Reconciliar:** resolver pagos aprobados, pedidos, stock y outboxes antes de reabrir.
9. **Validar:** smoke mínimo sobre la versión restaurada.
10. **Comunicar:** registrar incidente, impacto, decisiones y siguiente RC.

Restaurar un backup encima de staging/producción es el último recurso: podría borrar pedidos o callbacks posteriores al backup. El camino normal es rollback de aplicación más migración compensatoria.

El script `scripts/primer-pedido-humano/rollback.mjs` es una herramienta diagnóstica con supuestos específicos; no constituye por sí solo un rollback genérico certificado.

## 12. Qué falta para producción

Un piloto verde no habilita producción automáticamente. Antes de una Production RC:

1. Repetir todo sobre un entorno de producción aislado y un manifiesto nuevo.
2. Aprobar la arquitectura de migraciones y eliminar toda dependencia remote-only.
3. Tener remoto, CI, tags protegidos, firma y artefactos reproducibles para ambos repos.
4. Auditar backups/PITR y ejecutar un restore con RTO/RPO medidos.
5. Certificar Mercado Pago live con monto bajo, webhook automático, refund y conciliación.
6. Resolver con titular/contador el camino fiscal legal. Si ARCA automática no está lista, debe existir una alternativa manual explícitamente aprobada; no se presume.
7. Desplegar y homologar ARCA antes de habilitar automatización.
8. Firmar y distribuir un Rider release, no staging/debug.
9. Validar conectividad real, permisos/background, batería y operación en ruta.
10. Aprobar catálogo, inventario, precios, cobertura, horarios, envío, mínimo, alcohol y soporte.
11. Completar seguridad, privacidad, retención, roles y respuesta a incidentes.
12. Medir carga/capacidad y fallas de Supabase, Cloudflare, MP, Maps y red móvil.
13. Conectar alertas a personas con rotación y escalamiento.
14. Ejecutar rollback completo de Production RC antes de abrir ventas.

WhatsApp, Stories y el shelf ampliado pueden permanecer deshabilitados y no bloquean producción del core. Si se publicitan o habilitan, sus gates pasan a ser obligatorios.

## 13. Checklist de demo para Walter

### Antes de abrir la reunión

- [ ] Mostrar `TABA2-PILOT-RC2-CANDIDATE.N`, SHA web, SHA Rider, deployment ID y hash APK; manifiesto sin `TBD`.
- [ ] Confirmar que dice STAGING/TEST y que no se moverá dinero real.
- [ ] Consentimiento, acceso, retención y eliminación de dirección/GPS acordados antes de capturar.
- [ ] Elegir un SKU **no alcohólico** aprobado por Walter.
- [ ] Confirmar precio, stock, envío, mínimo, horario y cobertura.
- [ ] Verificar el punto de retiro en la puerta.
- [ ] Modo de red declarado: SIM nativa o hotspot-only. Si es hotspot, equipo proveedor cargado, con datos y junto al Rider.
- [ ] Moto cargado, GPS y notificaciones permitidos.
- [ ] APK instalada coincide con el hash del manifiesto.
- [ ] Rider correcto con sesión viva y sin pedido previo.
- [ ] Panel owner/admin con sesión separada.
- [ ] Pedido/stock baseline capturados.
- [ ] Observabilidad verde y responsables mirando.
- [ ] G6R ya ejecutado; deployment, Edge y APK de rollback certificados.
- [ ] Ningún otro agente/sesión puede mutar staging.

### Recorrido visible

- [ ] Cliente abre el storefront del candidato inmutable.
- [ ] Completa perfil y dirección.
- [ ] Usa “mi ubicación” y confirma el punto.
- [ ] Agrega el SKU; precio, envío y total cierran.
- [ ] Paga con Mercado Pago TEST.
- [ ] Vuelve a “Pedido confirmado” y ve un solo código de pedido.
- [ ] El Panel recibe el pedido sin recargar.
- [ ] Operador acepta, prepara y marca listo desde la UI.
- [ ] Doble click no duplica transición.
- [ ] Rider ve sólo zona aproximada antes de aceptar.
- [ ] Rider acepta y recién entonces ve la dirección exacta.
- [ ] Confirma pickup parado en el local.
- [ ] Inicia recorrido y abre navegación externa.
- [ ] El mapa del cliente muestra movimiento real.
- [ ] La traza cumple la ruta/duración/puntos acordados; no se acepta deriva GPS como recorrido.
- [ ] Apagar pantalla / background no detiene el tracking.
- [ ] Cortar y recuperar red no duplica ubicaciones ni estados.
- [ ] Matar y reabrir la app offline conserva la entrega activa.
- [ ] Código incorrecto es rechazado.
- [ ] Código correcto entrega exactamente una vez.
- [ ] Panel, Rider y cliente convergen a entregado.
- [ ] Observabilidad encuentra el pedido por correlation ID sin exponer PII.

### Cierre de demo

- [ ] Un pedido, un pago TEST, una reserva convertida, un `delivered_at`.
- [ ] Total y descuento invariantes.
- [ ] Cero reservas huérfanas.
- [ ] Cero outboxes pendientes.
- [ ] Cero eventos sin tipo.
- [ ] Stock esperado.
- [ ] Sin alertas críticas abiertas.
- [ ] Evidencia y hashes archivados.
- [ ] Pedido de demo reclasificado/limpiado mediante operación auditada, sin borrar historia.
- [ ] Walter firma los datos comerciales y el resultado GO/NO-GO.

### Lo que no se debe presentar como listo

- ARCA productiva u homologada.
- WhatsApp real.
- Stories multi-dispositivo/productivas.
- iPhone físico.
- Mercado Pago con dinero real.
- Catálogo completo.
- Venta de alcohol sin decisión comercial/legal.

## 14. Matriz de conflictos

| Combinación | Conflicto |
| --- | --- |
| Physical + Ops | 0 conflictos textuales simulados; alto riesgo de orden de migraciones/ACL |
| Ops + ARCA | 4 rutas co-modificadas; 1 conflicto textual simulado (`package.json`) y 5 versiones SQL colisionadas |
| Ops + WhatsApp | `package.json` y el mismo arreglo histórico de `20260806160000` |
| Physical + WhatsApp | Merge textual limpio, pero `20260807170000` colisiona fatalmente con Pickup |
| Physical + Stories | 8 conflictos de merge; 22 rutas modificadas por ambos deltas desde su merge-base |
| Physical + Pilot RC | 7 conflictos de merge; 19 rutas compartidas; cache/UI divergentes |
| Physical + Fable | 5 conflictos, principalmente UI/cache |
| Physical + Shelf | 2 conflictos: `js/core/beverage-home-sections.js` y su test |
| Physical + MP viejo | 16 conflictos; gran superficie de pagos/UI/backend |
| ARCA + WhatsApp | Poco conflicto textual, pero triggers, checkout, package y operación comparten dominio |
| Web + Rider | Sin conflicto Git por ser repos distintos; riesgo de contrato/API y versión desplegada |
| Cualquier rama + staging compartido | Riesgo mayor: alias, secretos, DB y Edge Functions son estado global no protegido por Git |

Archivos/superficies especialmente sensibles:

- `package.json` y comandos de gate.
- `js/production-operations.js`.
- `js/business/business-operations-center.js` y `business-panel-render.js`.
- `js/app.js`, `js/ui.js`, `index.html` y `styles.css`.
- `sw.js` y literales `?v=`.
- `js/repositories/supabase_order_repository.js`.
- `create_checkout_session`, `finalize_paid_checkout_session` y contratos de combos/pagos.
- Versiones de migración `20260804090000`, `20260806160000` y `20260807110000`–`170000`.
- `runtime-config.js`, allowed origins, checkout base URL y alias de Cloudflare.

## 15. Fuentes principales

- [Pilot RC](./la-taba2-pilot-rc/PILOT-RC-HANDOFF.md)
- [Pilot Integration](./la-taba2-pilot-integration/INTEGRATION-HANDOFF.md)
- [Panel hardening](./la-taba2-business-panel-hardening/BUSINESS-PANEL-HARDENING.md)
- [Tracking](./la-taba2-tracking-visual-polish/MAP-TRACKING-HANDOFF.md)
- [Physical E2E](./la-taba2-first-physical-e2e/FULL-E2E-HANDOFF.md)
- [Observabilidad](./la-taba2-pilot-ops/PILOT-OPS-HANDOFF.md)
- [ARCA](./la-taba2-arca-fiscal-automation/ARCA-FISCAL-HANDOFF.md)
- [WhatsApp Commerce](./la-taba2-whatsapp-commerce/WHATSAPP-COMMERCE-HANDOFF.md)
- [Stories](./la-taba2-commercial-stories/STORIES-COMMERCIAL-HANDOFF.md)
- [Storefront comercial](./la-taba2-commercial-storefront/HANDOFF.md)
- [Catálogo normalizado](./artifacts/taba2-unit-catalog-normalization/catalog-audit.md)
- [Bloqueos comerciales](./artifacts/taba2-commercial-p1-closure/commercial-data-blockers.md)
- [Shelf Stage 1](./artifacts/taba2-commercial-shelf-stage1/shelf-stage1.md)
- [Informe Mercado Pago E2E](./artifacts/taba2-mp-e2e-20260806/INFORME.md)
- [Contrato de migración remote-only](./la-taba2-first-physical-e2e/docs/migrations/remote-only/20260804090000_rider_map_location_contracts.README.sql)
- [Evidencia física](./artifacts/taba2-first-physical-e2e/)

## 16. Decisión final

**Hoy: NO-GO.**

La base técnicamente más defendible es `3d69e6b` + `7cec5a7`, no `main` ni `release/taba2-pilot-rc`. Esa base debe convertirse primero en un candidato inmutable mediante una integración mínima: autoridad de migraciones + Observabilidad + corrección offline Rider + recertificación y rollback.

ARCA, WhatsApp, Stories, Fable, Shelf y las ramas viejas de Mercado Pago quedan fuera. Integrarlas ahora aumentaría el área de fallo y borraría la única evidencia física útil.

La declaración permitida en este momento es:

> **TABA2_HAS_A_PHYSICAL_EVIDENCE_BASE_BUT_NO_PILOT_RELEASE_CANDIDATE_YET**

La próxima declaración técnica, después de P0.1–P0.16, puede ser:

> **TABA2-PILOT-RC2-CANDIDATE.N — FROZEN**

La declaración de release, sólo después de G7, puede ser:

> **TABA2-PILOT-RC2 — GO**

y exige promover el mismo manifiesto sin `TBD`, sin recompilar ni redesplegar, después de que Walter complete el checklist humano.
