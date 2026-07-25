# Plan técnico ejecutable de TABA

Fecha: 2026-07-25
Rama: `feat/taba-production-beverages`
Auditoría de entrada: `docs/audit/taba-production-audit.md`

## Principios de ejecución

1. Demo y producción son modos separados; nunca hay fallback silencioso.
2. PostgreSQL/Supabase es autoridad de catálogo, stock, precios, pedidos y estados.
3. El cliente sólo envía identificadores, cantidades y datos mínimos.
4. Todo cambio operativo requiere identidad y autorización de servidor.
5. Cada tarea debe dejar pruebas verdes antes de avanzar.
6. Ningún precio, stock, dirección, zona u horario se inventa.
7. El catálogo productivo queda cerrado hasta que el comercio valide los datos.

## Fase A — Cierre de riesgos inmediatos

### A1. Configuración de producción fuera de la URL

**Objetivo:** impedir que query strings activen endpoints o claves productivas.
**Archivos:** `js/config.js`, `js/core/app-mode.js`, `js/repositories/repository_factory.js`, nuevo runtime config, tests de factory/modo.
**Dependencias:** ninguna.
**Criterio de aceptación:** `data`, `api`, `supabaseUrl` y keys en la URL no pueden activar red; producción sólo se activa con configuración de despliegue completa.
**Pruebas:** unitarias para preview/demo/producción y configuración incompleta.
**Riesgo:** medio; cambia expectativas de links piloto existentes.

### A2. Coherencia de mensajes y envío

**Objetivo:** que la UI nunca diga “muestra/no enviado” si existe transporte productivo.
**Archivos:** `js/app.js`, `index.html`, tests E2E de honestidad.
**Dependencias:** A1.
**Criterio de aceptación:** preview crea sólo muestra local; producción confirma envío real; configuración productiva inválida bloquea checkout con error explícito.
**Pruebas:** unitarias de modo y E2E de copy/submit.
**Riesgo:** alto por PII si queda una ruta inconsistente.

### A3. Relay limitado a demo

**Objetivo:** evitar que el relay SSE se use como backend productivo.
**Archivos:** `js/realtime.js`, `repository_factory.js`, tests.
**Dependencias:** A1.
**Criterio de aceptación:** relay sólo se inicializa bajo `?demo=1`; producción ignora parámetros de relay.
**Pruebas:** unitarias/E2E de modos.
**Riesgo:** bajo.

## Fase B — Modelo productivo de bebidas y pedidos

### B1. Extender catálogo maestro

**Objetivo:** modelar bebidas sin cargar datos comerciales no verificados.
**Archivos:** nueva migración Supabase, `supabase/README.md`, plantilla CSV.
**Dependencias:** auditoría de catálogo.
**Criterio de aceptación:** `products` incluye ID/SKU, nombre, marca, categoría, subcategoría, presentación, capacidad, envase, precio, stock, disponible, alcohólico, imagen, etiquetas, orden y marcas de verificación.
**Pruebas:** schema test y migración real en Supabase local/prueba.
**Riesgo:** medio por compatibilidad con columnas legacy.

### B2. Configuración operativa verificable del comercio

**Objetivo:** cerrar pedidos hasta contar con tarifa, mínimo y operación aprobada.
**Archivos:** nueva migración, runtime/UI de disponibilidad.
**Dependencias:** B1.
**Criterio de aceptación:** la RPC rechaza pedidos si `ordering_enabled` o la verificación operacional no están activos.
**Pruebas:** RPC con negocio cerrado, no verificado y habilitado.
**Riesgo:** bajo; fail-closed deliberado.

### B3. RPC transaccional `create_taba_order`

**Objetivo:** crear pedido, ítems, evento y tracking en una transacción.
**Archivos:** nueva migración, adapter Supabase, smoke test.
**Dependencias:** B1, B2, Auth de cliente.
**Criterio de aceptación:** acepta sólo productos/cantidades y datos mínimos; calcula importes en servidor; genera IDs/folio; retorna pedido persistido; no deja pedidos parciales.
**Pruebas:** alta válida, producto inválido/inactivo, precio manipulado ignorado, stock insuficiente, total exacto.
**Riesgo:** alto; núcleo transaccional.

### B4. Idempotencia y stock concurrente

**Objetivo:** evitar duplicados y sobreventa.
**Archivos:** nueva migración, adapter.
**Dependencias:** B3.
**Criterio de aceptación:** retry del mismo `client_request_id` devuelve el mismo pedido; requests distintos bloquean stock; ninguna cantidad queda negativa.
**Pruebas:** retry secuencial y carrera paralela.
**Riesgo:** alto.

### B5. Estados atómicos y auditables

**Objetivo:** impedir estados impuestos por clientes o transiciones inválidas.
**Archivos:** nueva migración, adapter negocio/rider.
**Dependencias:** Auth/RLS.
**Criterio de aceptación:** RPC con `expected_status`, matriz de transición de servidor, actor/rol/fecha en evento, conflicto explícito ante concurrencia.
**Pruebas:** transiciones válidas, saltos inválidos, estado stale, acceso no autorizado.
**Riesgo:** alto.

## Fase C — Auth y RLS

### C1. Cliente anónimo autenticado

**Objetivo:** dar ownership y JWT al cliente sin exigir registro.
**Archivos:** cliente Supabase local, módulo Auth, migración `customer_user_id`, adapter.
**Dependencias:** Supabase Anonymous Sign-Ins habilitado.
**Criterio de aceptación:** el cliente sólo puede leer su pedido; Realtime usa su JWT; si no se obtiene sesión, no se envía PII.
**Pruebas:** cliente propio, otro cliente, sin sesión, sesión expirada.
**Riesgo:** medio; requiere control antiabuso y limpieza de usuarios anónimos.

### C2. Login de owner/staff/rider

**Objetivo:** reemplazar el PIN como seguridad productiva.
**Archivos:** módulo Auth, `index.html`, `js/app.js`, `js/ui.js`, `js/business.js`, `js/delivery.js`.
**Dependencias:** usuarios Auth y `business_members`.
**Criterio de aceptación:** email/password inicia sesión; rol se lee desde DB; owner/staff acceden a negocio; rider sólo a rider; PIN sólo aparece en demo.
**Pruebas:** login válido/inválido, logout local, rol cruzado, membresía inactiva.
**Riesgo:** alto.

### C3. Matriz RLS

**Objetivo:** probar aislamiento entre clientes, negocios y riders.
**Archivos:** migración y suite de integración SQL.
**Dependencias:** C1/C2.
**Criterio de aceptación:** todas las combinaciones autorizadas funcionan y las no autorizadas fallan.
**Pruebas:** anon key sin usuario, cliente A/B, owner/staff, rider asignado/no asignado, otro negocio, token correcto/incorrecto/expirado.
**Riesgo:** crítico.

### C4. Bootstrap controlado de miembros

**Objetivo:** dar de alta al primer owner sin exponer administración en frontend.
**Archivos:** runbook SQL/documentación; opcional script admin fuera del navegador.
**Dependencias:** credenciales/decisión humana.
**Criterio de aceptación:** proceso reproducible, auditable y sin clave privilegiada en el repo/browser.
**Pruebas:** alta, revocación y membresía inactiva.
**Riesgo:** alto.

## Fase D — Integración frontend productiva

### D1. Catálogo remoto fail-closed

**Objetivo:** mostrar sólo productos verificados de Supabase.
**Archivos:** adapter catálogo, `state.js`, `ui.js`, `cart.js`.
**Dependencias:** B1, runtime Supabase.
**Criterio de aceptación:** producción inicia sin catálogo estático; carga productos disponibles/verificados; error de red no muestra pizzas ni permite checkout.
**Pruebas:** catálogo vacío, carga correcta, producto pausado, stock actualizado.
**Riesgo:** alto.

### D2. Checkout mínimo

**Objetivo:** enviar sólo nombre, teléfono, dirección/zona/referencia, modalidad, pago coordinado y notas.
**Archivos:** `index.html`, `app.js`, adapter.
**Dependencias:** D1, B3.
**Criterio de aceptación:** campos mínimos, errores entendibles y respuesta persistida antes de éxito.
**Pruebas:** delivery/retiro, validaciones, timeout/retry idempotente.
**Riesgo:** medio.

### D3. Tracking de cliente

**Objetivo:** reflejar estado remoto sin depender del snapshot local.
**Archivos:** adapter, Auth, `ui.js`, Realtime.
**Dependencias:** C1, B5.
**Criterio de aceptación:** reload recupera el pedido por ownership/token; update de negocio aparece en el cliente; fallback polling visible si Realtime cae.
**Pruebas:** dos contextos, reload, token inválido, estado terminal.
**Riesgo:** alto.

### D4. Inbox del negocio

**Objetivo:** recibir y operar pedidos de su negocio.
**Archivos:** `business.js`, adapter, Realtime.
**Dependencias:** C2, B5.
**Criterio de aceptación:** nuevo pedido aparece sin refresh manual; cambios usan RPC; conflictos se informan.
**Pruebas:** owner/staff, otro negocio, doble operador.
**Riesgo:** alto.

### D5. Rider básico

**Objetivo:** asignar/tomar pedido y avanzar listo → en reparto → entregado.
**Archivos:** `delivery.js`, adapter, migración RPC claim.
**Dependencias:** C2, B5.
**Criterio de aceptación:** sólo rider del negocio; una sola asignación atómica; pickup excluido.
**Pruebas:** carreras de claim, no asignado, otro negocio, terminal.
**Riesgo:** alto.

### D6. GPS real mínimo

**Objetivo:** publicar fixes GPS del rider asignado sin simulación productiva.
**Archivos:** `delivery.js`, adapter, RLS.
**Dependencias:** D5, HTTPS.
**Criterio de aceptación:** sólo fuente GPS, throttle, rider asignado, pedido activo; cliente ve último fix autorizado.
**Pruebas:** permitido/denegado, ubicación inválida, stale, usuario no autorizado.
**Riesgo:** alto por privacidad.

## Fase E — Pivot UX/catálogo a bebidas

### E1. Taxonomía de bebidas

**Objetivo:** categorías visibles: Promos, Gaseosas, Aguas, Jugos, Energéticas, Isotónicas, Cervezas, Vinos y espumantes, Gins y vodkas, Whisky y destilados, Picadas y deli, Hielo y extras.
**Archivos:** catálogo remoto, UI, plantillas.
**Dependencias:** listado validado del comercio.
**Criterio de aceptación:** no quedan categorías de pizzería/carnicería en producción.
**Pruebas:** orden/categorías, búsqueda y filtro.
**Riesgo:** medio; depende de datos humanos.

### E2. Catálogo comercial verificado

**Objetivo:** cargar productos reales sin inventar precio/stock.
**Archivos:** import CSV/SQL, auditoría de fuentes de imágenes.
**Dependencias:** datos del comercio.
**Criterio de aceptación:** cada producto tiene presentación correcta, precio/stock verificados o permanece no disponible.
**Pruebas:** validación de esquema, duplicados, imágenes/fallback.
**Riesgo:** alto por exactitud comercial.

### E3. Simplificación mobile-first

**Objetivo:** una acción principal, menos texto/tarjetas/badges y checkout corto.
**Archivos:** `index.html`, `styles.css`, `ui.js`.
**Dependencias:** E1/E2.
**Criterio de aceptación:** Home prioriza buscador, promos, categorías, más vendidos, noche y carrito; sin overflow 320/360/390/412/768.
**Pruebas:** Playwright visual/responsive, teclado, foco y targets táctiles.
**Riesgo:** medio.

## Fase F — Validación y despliegue

### F1. Supabase local/prueba reproducible

**Objetivo:** aplicar todas las migraciones desde cero.
**Archivos:** `supabase/config.toml`, scripts y docs.
**Dependencias:** Supabase CLI + Docker o proyecto de prueba.
**Criterio de aceptación:** `db reset` sin errores, fixtures explícitamente de test.
**Pruebas:** esquema, RPC, RLS, stock, eventos.
**Riesgo:** crítico.

### F2. Pruebas multi-dispositivo

**Objetivo:** validar cliente, negocio y rider en contextos aislados.
**Archivos:** Playwright E2E productivo.
**Dependencias:** F1.
**Criterio de aceptación:** pedido real, actualización, Realtime, Auth y aislamiento entre celulares.
**Pruebas:** matriz completa y errores de consola/red.
**Riesgo:** alto.

### F3. Build/PWA/seguridad de frontend

**Objetivo:** artefacto local reproducible sin dependencias CDN no verificadas.
**Archivos:** scripts build, vendor local, SW, CSP/headers de hosting.
**Dependencias:** runtime final.
**Criterio de aceptación:** build limpio, todos los assets presentes, SW probado, sin secretos ni source de demo en producción.
**Pruebas:** build, auditoría de assets, PWA con service worker habilitado.
**Riesgo:** medio.

### F4. CI/CD y despliegue controlado

**Objetivo:** validar antes de publicar y separar preview/producción.
**Archivos:** workflow/plataforma de hosting, runbook.
**Dependencias:** dominio y plataforma decididos.
**Criterio de aceptación:** check + unit + E2E + migraciones + smoke; entorno de prueba antes de producción; rollback documentado.
**Pruebas:** pipeline y despliegue de prueba.
**Riesgo:** alto.

## Primera implementación autorizada en esta ejecución

Se comienza por:

1. A1/A2/A3: separación segura de modos.
2. B1/B2/B3/B4/B5: migración productiva y RPCs.
3. C1/C2: base Auth/JWT.
4. D1/D2/D3/D4: adapter productivo, catálogo remoto, checkout, tracking e inbox.
5. F1/F2: tests locales/mocks y smoke real condicionado a disponer de Supabase.

No se habilitará producción ni se inventará catálogo. Si faltan runtime/credenciales, el resultado debe quedar **fail-closed** y documentado.
