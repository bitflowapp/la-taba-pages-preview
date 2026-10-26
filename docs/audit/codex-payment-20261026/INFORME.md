# Auditoría independiente de pagos — 26/10/2026

**Dictamen: NO habilitar pagos comerciales todavía.** Se verificaron compras auténticas con dinero ficticio y se prepararon correcciones para seis grupos de defectos. Las correcciones están en una rama independiente y requieren revisión, despliegue QA y CI del SHA final. No se modificaron main, producción ni los worktrees de Claude.

Base examinada: `30af95c14a470db6e567d589c2a7c8faac524bd0`, PR #156, frontend v168. La propuesta usa identidad v169 para distinguir su contenido. GitHub confirmó que la ejecución verde [40251561069](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/40251561069) corresponde a `158ae943`, no a `30af95c1`.

Destino exclusivo: `la-taba-recovery-test`, `ixewllzzuzpqrkxzmfzx`, TestApp `4861627125869370`, entorno `test`. Identidad de integradora y vendedor confirmada como usuario de prueba `3594962708`; comprador autorizado `3594962710`. Los pagos Checkout Pro de estos usuarios reportan `live_mode: true`; la identidad de las cuentas, no ese booleano aislado, prueba el uso de dinero ficticio. Se usaron credenciales existentes del Credential Manager, sin exponerlas. Marco confirmó que QA estaba libre antes de abrir la ventana de pruebas.

## Operaciones nuevas y existencias

**Tres intentos de tarjeta nuevos; dos aprobados.** Importe acreditado ficticio: ARS 950. Importe todavía pendiente en Mercado Pago: ARS 350. No hubo POST nuevos de reembolso ni repetición de un pago exitoso para obtener una captura.

| Operación | Importe ARS | Pago Mercado Pago | Checkout | Pedido | Resultado independiente |
|---|---:|---|---|---|---|
| Dos productos, titular OTHE | 350 | `185083342105` | `627c27ae-64eb-4763-a6a9-fee9ed399b5c` | Ninguno | MP respondió `in_process / deferred_retry`, no el rechazo esperado. La reserva venció y se liberó; el pago sigue vigilado por el backend. No se pagó nuevamente ese checkout. |
| Un combo y dos productos, APRO | 850 | `185083451875` | `0dc1275b-2424-4e8a-b269-9a05deafe068` | `LT-0185`, UUID `b87d4874-781d-4551-9b00-dbef27d68551` | `approved / accredited`, intención completada, un pedido, tres reservas convertidas. |
| APRO con cierre del navegador antes del retorno | 100 | `186126875298` | `47d67f35-65e5-40ec-8044-7c5aa792fe21` | `LT-0186`, UUID `49e0e760-96ef-4d3e-9345-786191a3969c` | Pago acreditado y pedido confirmado sin cargar la pantalla de retorno. |

El cierre ocurrió a `03:46:08.515Z`; `LT-0186` se creó a `03:46:08.609Z`, después del cierre. Los parámetros del retorno fueron sólo pistas: la aprobación se cotejó posteriormente con GET de Mercado Pago y tablas de Supabase. [Eventos del navegador](evidence/browser-operation-events.json), [proveedor](evidence/close-provider-approved.json), [backend](evidence/close-db-approved.json).

En el combo, el servidor calculó subtotal 950, descuento 100 y total 850: seis unidades sintéticas de 100 con descuento y redondeo autoritativos producen un combo de 500; los otros productos cuestan 100 y 250. El checkout del combo se preparó mediante la API real de La Taba y se pagó en el Checkout Pro oficial. La compra de 350 sí recorrió catálogo, carrito, datos y selección de Mercado Pago en el storefront publicado.

| SKU en comercio A | Stock inicial | Stock final | Explicación |
|---|---:|---:|---|
| `QA-REC-001` | 19 | 17 | Una unidad en LT-0185 y una en LT-0186. La reserva del intento de 350 se liberó. |
| `QA-REC-002` | 10 | 9 | Una unidad en LT-0185; reserva del intento pendiente liberada. |
| `QA-REC-003` | 1 | 1 | La solicitud de dos unidades fue rechazada sin reserva ni pago. |
| `heineken-original-lata-473ml` — fixture Codex | 12 al crearlo | 6 | Seis unidades en LT-0185. Producto y combo quedaron inactivos al terminar; no se borraron sus registros financieros. |

Comercio B: cero pedidos, cero intenciones, `QA-MKT-001` conserva stock 5. El fixture de A usa identificadores exclusivos y datos sintéticos. QA quedó cerrado, conservando pedidos, pagos y auditoría. [Estado posterior](evidence/qa-snapshot-after.json), [retiro del fixture](evidence/combo-fixture-after.json), [conteos A/B](evidence/qa-counts-after.json).

## Matriz solicitada

Las categorías describen el alcance demostrado. Una prueba local no certifica el contrato del proveedor. Los controles de stock, precio y firma también se ejecutaron contra HTTP QA, pero se clasifican conservadoramente como prueba local cuando no implican una operación autenticada del proveedor. No se ejecutó el banco Docker con emulador en esta auditoría.

| Prueba | Resultado | Evidencia | Error encontrado |
|---|---|---|---|
| 1. Compra individual APRO | APROBADO CON MERCADO PAGO REAL EN QA. | Pago `186126875298`, LT-0186, ARS 100; además se releyó el aprobado histórico `185029125913` / LT-0184. | Ningún error nuevo en acreditación individual. |
| 2. Compra rechazada OTHE | BLOQUEADO POR DEPENDENCIA EXTERNA. | El nuevo `185083342105` quedó `deferred_retry`. El histórico `184725699779`, ARS 100, sí sigue `rejected / cc_rejected_other_reason`, sin pedido. | El proveedor no reprodujo el resultado OTHE esperado; no se cambió un estado para aparentar rechazo. |
| 3. Compra pendiente CONT | APROBADO CON MERCADO PAGO REAL EN QA. | Relectura independiente del histórico `185766963074`, ARS 100, `in_process / pending_contingency`; sin pedido y reserva ya vencida/liberada. | Se reutilizó evidencia existente en vez de generar otro pendiente. |
| 4. Varios productos | APROBADO CON MERCADO PAGO REAL EN QA. | LT-0185, ARS 850, componentes y dos SKU; importe, vendedor, pedido y reservas cotejados. | Ningún descuento doble de inventario observado. |
| 5. Combo | APROBADO CON MERCADO PAGO REAL EN QA. | LT-0185; combo 500 + productos 350. [Backend](evidence/combo-db-approved.json), [proveedor](evidence/combo-provider-approved.json). | F-01 y F-06: limpieza y visibilidad del carrito; correcciones verificadas aparte. |
| 6. Doble clic / solicitudes simultáneas | APROBADO CON PRUEBA LOCAL. | En QA, dos solicitudes secuenciales devolvieron el mismo init_point. Regresión Deno: antes dos POST, después uno. Ocho conexiones PostgreSQL: un solo dispatcher. | F-04; la carrera corregida todavía no se desplegó en QA. |
| 7. Pago aprobado con dos webhooks | APROBADO CON MERCADO PAGO REAL EN QA. | Replay firmado del auditor para pago real QA `185029125913`: dos HTTP 201, un recibo `c3827704-ef74-4792-858b-f89cda774047`, segundo `duplicate=true`, un pedido LT-0184. | El replay fue generado por el auditor, no se presenta como dos entregas naturales del proveedor. |
| 8. Rechazado que permite reintentar | BLOQUEADO POR DEPENDENCIA EXTERNA. | SQL y navegador verifican rechazo → reintento → aprobación sin duplicación; el nuevo OTHE real quedó incierto y no se volvió a pagar. | Secuencia completa nueva con Mercado Pago real pendiente. |
| 9. Cierre antes de volver | APROBADO CON MERCADO PAGO REAL EN QA. | LT-0186; cierre 94 ms antes de la creación del pedido; GET posterior confirma ARS 100 acreditados. | No dependió del retorno. |
| 10. Retorno manipulado | APROBADO CON PRUEBA LOCAL. | E2E: URL aprobada frente a backend pendiente no confirma. Además, cliente corregido contra QA real ignoró estado e ID ajenos y consultó su checkout. | Ninguna URL pudo fabricar acreditación. |
| 11. Pérdida temporal de conexión | APROBADO CON MERCADO PAGO REAL EN QA. | [Prueba híbrida](evidence/qa-return-resilience.json): primer request de estado abortado como `internetdisconnected`, segundo llega a QA real; cero nuevos checkouts y confirmación de LT-0186. | El corte se inyectó sólo en ese navegador; no se interrumpió la red de la PC. |
| 12. Stock insuficiente | APROBADO CON PRUEBA LOCAL. | SQL concurrente y HTTP QA: SKU con stock 1, pedido de 2 rechazado con 409; stock permanece 1. | Ningún stock negativo observado. |
| Aislamiento A/B, cinco pruebas de Claude | APROBADO CON PRUEBA LOCAL. | [5/5 PostgreSQL](evidence/marketplace-baseline.tap): cobrador ajeno, pedido/stock de B, devolución cruzada, RLS y listado del Panel. | Sin acceso cruzado en esas pruebas; no reemplazan R-MKT-1 real. |
| Precios, cantidades, comercio y sesión ajena | APROBADO CON PRUEBA LOCAL. | [HTTP QA](evidence/qa-adversarial.json): 409 a total alterado, cantidades negativas/fraccionarias, comercio ajeno y stock; 404 a checkout de otro comprador, sin cambiar stock. | Controles resistieron. |
| Webhooks falsificados | APROBADO CON PRUEBA LOCAL. | [QA real HTTP y Deno](evidence/qa-actions.jsonl): seis falsificaciones rechazadas 401. | No entraron al procesador financiero. |
| Devolución externa | APROBADO CON MERCADO PAGO REAL EN QA. | Relectura de `184722117633` y refund `3468882144`, ARS 100: MP `refunded`, backend `external / approved`, LT-0087 cancelado. | Sin volver a ejecutar el reembolso. |
| Reembolso por API, 401 cause 7 | BLOQUEADO POR DEPENDENCIA EXTERNA. | Registro auténtico previo de ARS 8,20 sigue `rejected`, una fila, sin ID de refund. Scopes actuales de refunds/cancel son read-only; handler probado ante 401. | F-05 impedía distinguir ese permiso limitado. No se repitió el POST conocido. |
| R-MKT-1 con segundo vendedor | BLOQUEADO POR DEPENDENCIA EXTERNA. | Preflight actual: B desconectado, credencial vendedor B ausente. Procedimiento preparado y autorización solicitada. | Sin segundo vendedor no se certifica separación de dinero entre cuentas auténticas distintas. |

## Defectos reproducidos y correcciones

| ID / severidad | Reproducción y causa | Corrección preparada | Regresión |
|---|---|---|---|
| F-01 / P2, carrito | Un pago de producto vaciaba un combo nuevo; los componentes expandidos de un combo borraban unidades sueltas nuevas. Dos respuestas simultáneas descontaban el carrito dos veces. | Guardar la selección original de productos separada de combos; retirar sólo esas cantidades; no usar clearCart global; aplicar el resultado completado una sola vez. Registros antiguos de combos preservan las unidades sueltas cuando no se puede distinguir su origen. | Tres fallos de carrito + carrera en rojo; [11/11](evidence/cart-return-final.tap) después. Registros viejos con combos pueden conservar unidades sueltas ya pagadas: se preserva información frente a borrar compras nuevas. |
| F-02 / P1, devolución ambigua | Un operador podía marcar 2500 devueltos con evidencia de 500, rechazada, pendiente o ausente. También podía declarar “no ejecutado” y abrir otro refund UUID aun existiendo evidencia aprobada. | Migraciones 01 y 03: exigir ID, importe exacto y estado aprobado capturados por servidor; impedir liberar incertidumbre mediante una nota. Los rechazos definitivos del proveedor conservan su camino automático. | [Antes](evidence/refund-resolution-before.tap), [liberación negativa antes](evidence/refund-negative-resolution-before.tap), [64/64 afectados](evidence/postgres-final-regressions.tap). Resolver una incertidumbre sin identidad puede requerir intervención del proveedor. |
| F-03 / P1, conciliación | Orden diferente de pagos con el mismo timestamp: ventana completada habiendo visto sólo A/B, omitiendo C/D. | Checkpoints sin offset durable; enumerar grupo en intervalo temporal exacto, exigir cobertura de IDs únicos y total estable; límites/reintentos acotados, error visible ante cobertura incompleta. | [Rojo](evidence/ledger-before.tap), suite original conservada y adversarios en verde. [API real](evidence/ledger-provider-boundary.json) confirma la búsqueda por instante exacto. Grupos >10000 o un índice inestable quedan pendientes de conciliación, sin avanzar el watermark. |
| F-04 / P1, preferencias | Dos búsquedas concurrentes vacías enviaban dos POST. La exclusión local dependía de una idempotencia de preferencias que no estaba demostrada con el proveedor. | Migración 02 + handler: claim atómico antes del POST y snapshot de autoridad actualizado. Un `request_sent` no se vuelve a adquirir. | [Antes dos POST](evidence/preference-race-before.log); después uno y respuestas 200/202; [ocho conexiones, un dueño](evidence/preference-dispatch-postgres.tap). Un crash después del claim puede requerir conciliación manual; no se reenvía a ciegas. |
| F-05 / P2, permisos | Scopes genéricos read/write hacían que el verificador certificara permisos aunque refunds/cancel estuvieran explícitamente read-only. | La verificación rechaza esa contradicción y conserva el estado de permisos faltantes. No otorga permisos que Mercado Pago no dio. | [Dos fallos antes](evidence/permissions-before.log), [13/13 después](evidence/permissions-after.log). |
| F-06 / P2, combos ocultos | Cada render de applyAppMode apagaba la disponibilidad ya confirmada; al salir del carrito desaparecían los combos. | Reiniciar el gate sólo al cambiar de modo; actualizar disponibilidad en superficies de compra y cambios de sesión sin crear identidades al consultar. La apertura de catálogo no espera la llamada de pagos. | [E2E rojo](evidence/combo-ui-before.log), [20 recorridos](evidence/browser-local-final.log), [2/2 finales](evidence/combo-ui-final.log). [Cliente coherente sobre QA real](evidence/qa-combo-ui-coherent.json): un combo visible, precio 500. |

Las regresiones financieras recuperadas de una auditoría local anterior se volvieron a ejecutar contra la cabeza concreta del PR; no se aceptaron sus resultados como evidencia nueva. Las pruebas antiguas que permitían resolver devoluciones sin confirmación se endurecieron para reflejar la corrección; las fixtures de evidencia válida ahora incluyen estado `approved`. Los logs rojos se conservaron. No se silenciaron fallos ni se eliminaron controles de dinero o inventario.

## Validación y límites

- PostgreSQL local 18.4 en clúster exclusivo, loopback, 174 migraciones base y tres nuevas en la base corregida; QA usa PostgreSQL 17.11 y conserva sus 174 migraciones publicadas. 64 regresiones afectadas + 61 de otros flujos, todas aprobadas; incluyen las cinco de marketplace, ocho contendientes por un claim y carreras reales de inventario/finalización. Cron/net/Vault están modelados por tablas locales; no certifican servicios gestionados.
- Deno 2.6.1, red prohibida: **297/297**. Incluyen el handler real, autoridad, firmas, errores y refunds con proveedor sustituido por fixtures.
- Navegador local Chromium: **20/20**, sin reintentos. Tras ajustar la consulta inicial en segundo plano, **2/2** de cliente nuevo/combos y **4/4** de sesión revalidados.
- Corrida ampliada Node: **3248 ejecutadas, 3247 aprobadas y un fallo de cableado textual** al extender la condición de navegación. Se corrigió el código conservando la rama explícita del carrito; ese archivo pasó **4/4** después. No se presenta esa corrida anterior como una CI completa verde del SHA final.
- `npm run check`, escaneo de secretos y validación estática de migraciones aprobados. Typecheck de los tres entrypoints afectados aprobado. Se usaron paquetes y binarios existentes; no se instaló Docker ni se descargaron imágenes. El banco integral con emulador no se repitió.
- Los ensayos de interfaz con backend QA usaron el grafo completo del cliente local mediante interceptación del navegador. Un intento intermedio mezclando módulos publicados y nuevos no abrió la tienda; se conservó el diagnóstico y se corrigió el arnés. No hubo despliegue de frontend, funciones ni migraciones a QA o producción.
- D: pasó de 35,17 GB libres a aproximadamente 34,3 GB. C: tenía 10,41 GB inicialmente. No hubo limpiezas de disco ni acceso de trabajo a F:.
- Las compras nuevas están pagadas a un único vendedor de prueba que también es dueño de TestApp. No demuestran la topología integradora distinta del vendedor B, comisiones, neto comercial ni una devolución por API autorizada en producción.

## R-MKT-1 y activación comercial

[Procedimiento revisado](../payments-final-20261025/R-MKT-1-PROCEDIMIENTO.md). Se confirmó que no existe la credencial de vendedor B y que su conexión está desconectada. No se creó ninguna cuenta Mercado Pago ni se autorizó OAuth. Se solicitó exclusivamente autorización para un vendedor argentino de prueba y su consentimiento sobre QA B; sigue pendiente de respuesta.

Antes de habilitar pagos comerciales: revisar e integrar las correcciones, desplegar las tres migraciones antes del handler de preferencias, certificar el SHA exacto en CI y QA, completar R-MKT-1 con un segundo vendedor autorizado y resolver/certificar los permisos reales de devolución. La operación OTHE de 350 debe seguir bajo vigilancia hasta un estado final; su reserva liberada no significa que el proveedor haya rechazado el dinero.

No se solicita ni ejecuta dinero real dentro de esta auditoría. La verificación comercial posterior requiere la autorización que corresponda y queda fuera de estos ensayos ficticios.

## Fuentes y evidencia

- [Manifiesto SHA-256](evidence/manifest.json): archivos saneados, sin sesiones de navegador ni secretos.
- [Mercado Pago: tarjetas y resultados de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases).
- [Mercado Pago: fechas, paginación y límites de búsqueda](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/payment-management). La cobertura de empates se comprobó con adversarios y una consulta exacta real, sin asumir un orden secundario no documentado.
- Skills consultadas: `mercadopago:mp-review`, `mercadopago:mp-webhooks`, `mercadopago:mp-test-setup`, versión 4.3.2. No se usaron herramientas oficiales quality_checklist/evaluation ni se inventó un resultado de homologación.

## Implementation Report

### Verified
- [x] Tres operaciones nuevas con cuentas de prueba y contraste Mercado Pago/backend.
- [x] Pedido confirmado después de cerrar el navegador, inventario, replay firmado y controles adversarios.
- [x] Cinco pruebas PostgreSQL de marketplace; regresiones de seis grupos de defectos.

### Needs attention
- [ ] Desplegar y recertificar las correcciones; CI del commit final.
- [ ] Estado final del pago 185083342105, sin volver a pagarlo.
- [ ] La resolución de un refund ambiguo exige confirmación del proveedor; una nota ya no libera el bloqueo.

### Blockers (must fix before production)
- [ ] Segundo vendedor de prueba y R-MKT-1 auténtico.
- [ ] Reembolso por API con permisos efectivos y resultado verificado.
- [ ] Revisión/integración de correcciones y certificación de release exacto.

### Next steps
1. Revisar el PR independiente y desplegar en QA con migraciones antes de funciones.
2. Completar los ensayos externos autorizados pendientes sin repetir cobros exitosos.
3. Reauditar el SHA candidato antes de abrir pagos comerciales.

### Resources used
- Local: PostgreSQL exclusivo, Node, Deno y Chromium existentes.
- Conectados: GitHub, Supabase QA y Mercado Pago de pruebas.
- Skill: mp-review v4.3.2 y guías de firmas/cuentas de prueba.

**Scores:** calidad oficial N/A. Seguridad: ocho controles de base verificados; idempotencia del dispatcher corregida localmente, pendiente de despliegue/certificación externa. **Verdict: Blocked / NO-GO.**
