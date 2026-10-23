# Matriz GO / NO-GO — cobros reales de La Taba

23/10/2026. Veredicto de ingeniería: **NO-GO para cobrar a clientes reales hoy, por razones de infraestructura y de autorización, no porque el flujo de cobro no funcione**. El flujo de cobro, en QA y con dinero ficticio, funciona de punta a punta: pago aprobado, rechazado y pendiente; pedido y stock una sola vez; webhook firmado; conciliación; reembolso del vendedor conciliado; todo reproducido y con revisión independiente. Lo que falta no es de código y está ordenado abajo.

Leyenda: **BLOQUEO** = sin esto no se cobra. **LÍMITE QA** = el entorno de pruebas no puede demostrarlo; no bloquea, deja un riesgo medido y una forma de cerrarlo. **NO CRÍTICO** = mejora o decisión que no impide cobrar.

## A. Bloqueos reales

| ID | Qué | Estado hoy | Cómo se cierra | Titular |
|---|---|---|---|---|
| A1 | **No existe un proyecto de producción de La Taba.** Sólo hay `la-taba-recovery-test`, plan Free, de pruebas (`evidencia 13`) | Los proyectos productivos anteriores ya no aparecen. Los datos recuperados son 72 productos privados: cero usuarios, pedidos o pagos | Crear el proyecto de pago y cargarlo (plan F2) | Luna Systems (costo) |
| A2 | **El código y el pipeline están atados a proyectos que ya no existen**: `DEPLOYMENT_BINDINGS`, `release-edge-production.yml`, scripts `release:edge:*`, lista de aislamiento de pilotos, secretos A1–A4 del release, `compatibility.json` y herramientas de release V5 (snapshot inerte espera 14 disparadores, hay 17) sin re-baseline | Un proyecto nuevo **no puede cobrar** hasta agregar su ref al binding de producción (defensa por diseño) | PR de binding + reapuntar el workflow + re-baseline, con CI verde del SHA exacto (F2.2) | ingeniería, tras A1 |
| A3 | **Aplicación de Mercado Pago de producción sin verificar**: callback, webhook (URL, evento, clave) y permisos de `La Taba Delivery` sólo los puede ver su dueño; el Client Secret se expuso en un diagnóstico el 6/10 y la renovación está pendiente | Sin sesión de Developers del dueño en esta PC | Sesión del dueño (MFA propia), renovar el secreto, registrar URLs, correr la lectura del dueño de la app (`test_user` ausente) (F3) | dueño de la app |
| A4 | **Marketplace con vendedor distinto del dueño de la app, sin demostrar** (R-MKT-1: el ruteo exige que `user_id` del webhook sea el vendedor; hoy ambos son la misma cuenta) | Preparado, no ejecutado | `VERIFICACION-MARKETPLACE.md` en QA, o el canary F6 con vigilancia. Una falla **no pierde dinero** (el barrido de verdad lee el pago sin el webhook: pedido completo 9 s después del pago en la prueba APRO), pero retrasa pedidos | titular de la cuenta de prueba / Walter |
| A5 | **Recuperación ante pérdida**: copia externa, custodio separado de la clave y restauración integral ensayada; RPO/RTO sin acordar. No hay medición de RTO | Paquete local cifrado y verificado; destino externo y clave sin definir | F5 | Marco / Walter |
| A6 | **Autorizaciones de Walter**: conectar **su** cuenta, habilitar el cobro, importe del pago real de control, catálogo y precios reales, caja/entregas/devoluciones | Ninguna otorgada | F6 y `catalog/opening/OWNER-INPUT.md` | Walter |
| A7 | **Primer cobro real y primer reembolso real de control**: nada de dinero real se movió nunca por esta arquitectura | No ejecutado | Canary con monto mínimo (F6.3–F6.4) | Walter + operador |
| A8 | **Hallazgos de la revisión independiente del núcleo financiero (#148)** | Corregidos en la migración `20261023210000` + worker (disputa `in_mediation`, barrido de 48 h, aislamiento entre comercios, id de reembolso verificado); los bajos están aceptados por escrito en `REVISION-INDEPENDIENTE.md`. **Aplicada y verificada en QA el 23/10** (respaldo cifrado + recuperación comprobada + ensayo + 28/28 de aislamiento + 83 escenarios + 2 simulacros con el worker real; ver `DESPLIEGUE-QA.md`). Falta aplicarla al proyecto de producción con las demás (F2.3) | aplicar la migración y desplegar el worker en producción; sin ella la disputa de un pedido cobrado lo deja en revisión bloqueante | ingeniería, tras A1 |
| A9 | **El sitio público `la-taba.pages.dev` apunta a un backend que ya no existe**: sirve la v144 y su `runtime-config.js` nombra `wwcpogltfgzgkrlilbcd` | **Verificado hoy** (lectura pública) | publicar el frontend nuevo o retirar el sitio antes de cualquier difusión | Marco |

## B. Limitaciones del entorno de pruebas (no bloquean; riesgo medido)

| ID | Limitación | Qué se sabe | Cómo se cubre |
|---|---|---|---|
| B1 | **El reembolso por API responde 401 (cause 7) para la credencial de prueba**, incluso sobre un pago rechazado: rechazo en la capa de autorización, no del pedido (`REEMBOLSO-401.md`, evidencias 11 y 12) | El pedido de La Taba cumple la referencia oficial; no hay nada configurable de nuestro lado (la app ya tiene Checkout Pro, API de Preferencias, PKCE, read/write/offline) | El **reembolso desde la cuenta del vendedor sí funciona y La Taba lo concilia** una sola vez (probado). La API se certifica con el primer reembolso real de control. Consulta opcional a soporte (texto listo) |
| B2 | La app de prueba está autoautorizada: Mercado Pago marca `marketplace: NONE` | No se ejerce comisión ni liquidación de marketplace | A4; en producción La Taba no cobra `marketplace_fee` |
| B3 | Los pagos entre usuarios de prueba informan `live_mode=true` | Es el comportamiento medido (pago `184722117633`) | Las guardas usan el **entorno** ligado a la etiqueta `test_user`, no ese campo; contador informativo en el preflight |
| B4 | QA corre en plan Free: sin PITR, con pausa por inactividad, cron/Vault administrados | Documentado | Producción usa plan de pago (A1) y ensayo de restauración (A5) |
| B5 | Las pruebas de base de datos usan PostgreSQL real local con cron/`net`/Vault simulados | 141/141 en el cierre anterior | La verificación alojada de la rama cubre cron, Vault y HMAC reales en QA |
| B6 | Sin homologación oficial de «calidad de integración» por `payment_id` real | Checklist de 36 ítems revisado; la calificación la emite Mercado Pago | Se solicita tras el primer pago real |
| B7 | La sesión de Developers de la cuenta dueña de QA (SMS al celular terminado en 9136) | Sólo el titular | no bloquea producción |

## C. No críticos (no impiden cobrar)

| ID | Tarea | Nota |
|---|---|---|
| C1 | **Devolver el dinero no cancela el pedido ni repone stock** (el pedido `LT-0087` siguió `received`) | Procedimiento al encargado (plan §3); mejora futura: ofrecer «cancelar pedido» al confirmar la devolución |
| C2 | Facturación electrónica (ARCA) apagada | Decisión legal/contable de Walter (D6) |
| C3 | Bytes de Storage fuera del respaldo | Subir imágenes desde la fuente; incluir en el inventario de recuperación |
| C4 | SMTP propio y plantillas de Auth; avisos al comercio | Necesario para recuperar contraseñas del Panel; configurar en F2.5 |
| C5 | Autorización para borrar las bases de restauración `taba_restore_20261022_ad3d29a2` y `taba_restore_20261023_e9ba39c2` (ensayo de este despliegue) y el inquilino sintético `drill-fb-qa` de QA | Housekeeping |
| C9 | La suite `mercadopago_operator_switch.local.sql` usa un `seller_id` fijo (`3594962708`) que ahora es un vendedor real conectado en QA; falla en QA tal cual está (16/16 con la fila apartada en la transacción) | Darle un id propio; no afecta producción |
| C10 | Las pruebas de `tests/db` no son aisladas en una base poblada: `enqueue_checkout_provider_probes` y `claim_provider_ledger_window` toman trabajo de comercios reales | Sólo importa si se corren fuera de una base local desechable |
| C6 | Segundo vendedor de prueba y su pago (A4 es el que importa); cuentas de prueba no se pueden borrar (límite 15) | Una cuenta más |
| C7 | Retirar de TestApp/TABA2 Staging lo que ya no se use; consolidar documentación histórica | Limpieza |
| C8 | Advertencias de asesores de Supabase/Auth heredadas | Revisar en producción |

## D. Qué cambió en esta etapa y es seguro para producción

| Cambio | ¿Altera producción? |
|---|---|
| `tokenGrant` sin `test_token` | no: en producción nunca se envió; la regla `live_mode` de producción tiene prueba propia |
| Guarda del integrador | sí, **a propósito**: bloquea sólo un desajuste confirmado del dueño de la app; si no puede leerlo, deja vender y lo registra (revisión 1, hallazgo 2) |
| Ignorar el IPN legacy | sí: elimina falsos avisos en cada venta; nunca traga un webhook firmado (prueba) |
| Pines `RECOVERY_TEST_APPLICATION_ID` | no: sólo el binding de QA y sus herramientas |
| Migración `20261023210000` y worker | sí, **a propósito**: sólo cambia el trato de disputas, el barrido de 48 h, el aislamiento entre comercios y la verificación del id de reembolso; reversa en `docs/migrations/rollback/`; 11 pruebas de base en rojo sin ella y en verde con ella, y **11/11 también en QA tras aplicarla** (`DESPLIEGUE-QA.md`) |
| Bindings de producción | **sin cambios** (confirmado en el diff por el revisor) |
| Interruptores | `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` y `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` siguen siendo las llaves de producción; nada de esto los toca |

## E. Condición para pasar a GO

GO técnico cuando A1–A5 y A8–A9 estén cerrados y las pruebas sin dinero de F4 pasen en el proyecto de producción. **GO comercial** cuando además Walter otorgue A6 y el canary A7 salga limpio; la apertura es gradual (5 → 15 → 30 clientes) con apagado inmediato por comercio.
