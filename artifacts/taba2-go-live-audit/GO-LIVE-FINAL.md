# LA TABA — COMMERCIAL GO-LIVE FINAL · 2026-08-21

Estado medido, no supuesto. Producción `wwcpogltfgzgkrlilbcd` · web `https://la-taba.pages.dev` ·
main productivo `95ac129` (= origin/main = local) · ledger 112/112 exacto contra el repo,
última `20260819060000`. Evidencia cruda en `artifacts/taba2-go-live-audit/` y
`artifacts/taba2-gondola-retail-final/`.

## VEREDICTO

**LA TABA — READY TO TAKE REAL CUSTOMER ORDERS** (venta en efectivo/coordinar), con
**P0 = 0** en las seis auditorías. Lo que falta para la góndola final y para escalar
son GATES HUMANOS y P1s, listados abajo — ninguno impide vender hoy.

## P0 — impide vender hoy

**Ninguno encontrado.** La cadena completa está viva en producción y lo demuestra
LT-0001 (pedido real del 18/08: checkout → received → accepted → preparing → ready →
rider ofrecido/aceptado → picked_up → on_the_way). El único eslabón jamás demostrado
en producción es `delivered` + PIN: LT-0001 terminó en `rider_issue_reported
(customer_unavailable)` y nadie lo cerró.

## GATES HUMANOS ABIERTOS (en orden)

### GATE A — Góndola final 60 → 72 (listo para disparar, 2 comandos)
El lote de 12 altas está certificado hasta el borde de la escritura:
- SHA-256 verificado: `56a7127e…47d1a6` · 30/30 tests de propuesta · 1929/1929 suite completa
- Ensayo read-only contra producción: PASS (0 colisiones SKU, 0 GTIN, 60/60 presentes, alcohol=false)
- Esquema certificado contra producción: 31+11 columnas, NOT NULL cubiertas, unicidad
  del aborta-por-colisión real, CHECKs revisados a mano ('Jugos' ya es categoría canónica)
- Staging NO sirve como gate (diagnóstico completo): 96/112 migraciones (le falta
  `sold_as_pack`), catálogo de 23 productos que no comparte NI UNO de los 60,
  0 códigos de barras, 124 pedidos QA, alcohol=true fixture de demos desde ≥13/08.
  El ensayo staging quedó BLOQUEADO honesto (exit 2) leyendo el diagnóstico completo.
Al autorizar Marco, se corre: (1) `--ensayo-transaccional` (ejecuta el lote real y
ROLLBACK: nada queda), (2) `--aplicar --verificado-por=<uuid-owner>`. Los 12 nacen
stock=0 · available=false: NADIE los ve hasta la Recepción real en el Panel.

### GATE B — Decisiones de negocio (Panel, sin consola)
1. **Tarifa y mínimo**: los $0/$0 vigentes los puso un script de plataforma
   (`business_config_audit` id 1, actor `service`) para destrabar el checkout — no
   fueron decisión comercial. El Panel ya tiene la pantalla de configuración
   operativa. Marco decide valores (o ratifica envío $0).
2. **Horarios**: `hours_enforced=false` = tienda 24/7 literal (un pedido a las 4 AM
   entra y queda `received`). Aceptable para piloto controlado; ANTES de publicidad,
   cargar franjas + encender la bandera (Panel).
3. **Cerrar LT-0001**: on_the_way desde el 18/08 con `customer_unavailable`.
   Cancelar con motivo desde el Panel (efectivo: sin reversa financiera) o marcar el
   desenlace real.
4. **WhatsApp de coordinación**: `whatsapp_phone=NULL` — «A coordinar» hoy implica
   llamar. Cargar el número del comercio.

### GATE C — Física comercial (Marco + Moto G15)
1. **Recepción real**: Panel → Recepción de mercadería → escanear GTIN → cantidad
   real → Guardar → Publicar en tienda. Valida el flujo E2E de stock del Objetivo 4
   con mercadería de verdad (los 12 nuevos y/o reposición de los 33).
2. **Primera venta controlada completa**: Customer → checkout (efectivo) → Panel
   acepta/prepara/listo → ofrecer Rider → Rider real (com.lataba.rider 1.0.0, ya
   instalado en el Moto el 17/08) → tracking → **delivered + PIN** — el eslabón que
   LT-0001 dejó sin demostrar. Con gate explícito: es un pedido productivo real.

## P1 — antes de publicidad masiva (ninguno bloquea el piloto)

1. **SMTP** sin configurar (compuerta conocida desde el 17/08): sin él no hay
   recuperación de contraseña ni confirmación de altas del equipo (2 mails/hora
   best-effort). Riesgo real: lockout del ÚNICO owner. La venta anónima no lo toca.
2. **Turnstile/CAPTCHA apagado** con pedidos abiertos (su plazo interno ya venció).
3. **Cobertura de delivery apagada**: 0 zonas, radio null — medido en vivo: una
   dirección a 1.130 km es `eligible=true`. Encender radio exige además cargar y
   verificar la ubicación del negocio (hoy 0 filas en
   `rider_map_business_locations`; por eso el pin del mapa tampoco se dibuja).
4. **Mercado Pago production: NO EXISTE** (0 filas de settings, 5 Edge Functions sin
   desplegar, RPC devuelve `available:false`). El cliente hoy paga efectivo o
   coordina. Si Marco quiere cobrar con MP: cuenta MP real del comercio + secretos +
   deploy de funciones + fila de settings + webhook (larga lista en la evidencia de
   pagos). Es P1 porque HAY medio de pago real válido (efectivo).
5. **CSP ausente** en el host estático (endurecimiento de mejor costo/valor).
6. **Cerrar el runbook de pedidos colgados** (LT-0001 mostró el hueco operativo).

## P2 (después)

'jugos' fuera del rail del home (vive en chips/categorías, igual que Isotónicas hoy) ·
watchdog anon con escritura acotada · `production-security-smoke.mjs` muta y su
aserción quedó obsoleta · ACAO `*` · HSTS por precarga · vuelto/pickup apagado ·
vocabulario legacy de estados · sesiones sin caducidad · oráculo de enumeración en
/recover (colateral del no-SMTP).

## CATÁLOGO

- HOY: 60 productos · 33 visibles y comprables · 23 alcohólicos cargados y CERRADOS
  (LICENSE GATE intacto) · 4 unidades minoristas stock 0 · 5 packs · 4 packshots
  oficiales · resto fallback TABA honesto.
- CON GATE A: 72 productos; los 12 nuevos (4 gaseosas 1,5 L · 2 aguas familiares ·
  2 jugos 1,5 L · 4 cervezas pack x6) entran cerrados hasta la Recepción.
- Imágenes de los 12: fuente aprobada sólo cubre el sistema Coca-Cola (hasta 6
  candidatos vía tienda Andina VTEX); Danone y ABI no publican catálogo programático
  (medido 18/08). Lo que no tenga match exacto oficial queda en fallback TABA.
  Descubrimiento corre DESPUÉS del apply; asociación de imágenes = gate propio.

## OPERACIÓN

- Stock: Panel → Recepción → `apply_inventory_movement` → publicar/ocultar vía
  `set_commercial_product_publication` (migración `20260819060000`, LIVE). Sin consola.
- Pedidos: llegan al Panel (LT-0001 lo demostró) · estados con máquina validada ·
  cancelación exige motivo 3–300 chars · pedido cobrado por MP exige reversa antes
  de cancelar.
- Rider: cuenta real activa en producción · APK de producción en el Moto ·
  ofrecer/aceptar/estados demostrados en producción el 18/08.
- Panel config operativa (horarios/zonas/fee/mínimo): pantalla existente con
  permisos (`can_manage`), auditoría before/after.

## PAGOS

Efectivo + «a coordinar» VIVOS (checkout production `mode:'production'`); el rider
recibe `collection_amount=total` en efectivo. Comprobante falso: el vector NO existe
(no hay transferencia+comprobante en el checkout; un pedido no puede declararse MP
sin `payment_intent` completed — constraint trigger). MP production: ver P1-4.

## AUTH

Postura = la esperada (production:auth PASS): signup abierto a propósito (el
cliente anónimo compra sin registrarse), confirmación de email exigida, JWT 3600s,
rotación de refresh ON, password 12+ con HIBP, MFA TOTP disponible, rate limits
todos > 0. SMTP = P1-1. Recovery: completo en código, muerto sin SMTP.

## UX CLIENTE (auditoría en vivo, 390×844, 13 capturas)

La tienda vende hoy: 33/33 en catálogo, precios sobre el pliegue, carrito y
checkout abren con CERO errores de consola y red limpia. Fallback TABA honesto
con aria-label. Búsquedas razonables («cerveza»→0 con vacío digno = LICENSE GATE).
Tres P1 medidos, los tres RESUELTOS en el candidato v81 de esta rama:
- A1 · abrir el carrito creaba una identidad anónima permanente en auth.users por
  visitante (POST /auth/v1/signup vía la consulta de disponibilidad de MP con
  `createIfMissing:true`). FIX: la consulta pregunta sin crear sesión; se repara
  sola al existir una real. (La auditoría dejó 2 filas anónimas midiendo el
  defecto — limpieza opcional en el gate.)
- A2 · 29/33 tarjetas sin litraje (2,25 L indistinguible de la lata 354 ml salvo
  precio; la góndola final trae DOS «Coca-Cola Original» a propósito). FIX:
  `js/core/product-presentation.js` — «1,5 L · Sin azúcar», «Pack x6 · 473 ml»,
  slugs nunca («botella-pet» → «Botella PET»). 10 tests propios.
- A3 · orden comercial: la home abría Gaseosas con packs de 500 ml arriba de las
  2,25 L (los 4 packs históricos llevan sort_order 1..4). FIX: lote de curación
  de sort_order (72 SKU, familiar→packs→chicos, DB-side, gateado, post-altas).

## CLIENTE v81 (candidato de deploy)

`3506c67` sobre la rama: A1 + A2 + sección Jugos en la home (se dibuja sola
cuando haya un jugo comprable) + SW `la-taba-runtime-v81-gondola-legible`
(131 precacheados, identidad re-firmada). Units 1939/1939 · npm run check verde.
E2E COMPLETA sobre el candidato: 455 tests en verde (153+162+64+76, chromium y
mobile-webkit, los 57 archivos), 0 fallas reales — la única ✘ fue un flake de
foco del Panel bajo carga doble, verde en re-corrida aislada (1.6s).
Paquete de deploy CONSTRUIDO y validado: dist_release con sw v81, sin rutas
prohibidas, runtime-config productivo derivado (789 B, sha256 ddee8a48…).
Deploy: `wrangler pages deploy` al proyecto `la-taba` (sesión OAuth verificada;
el deploy vivo `ee843b3b` salió de `95ac129` por rama main), paquete
`release:folder` + runtime-config DERIVADO con guardas fail-closed
(`build-production-runtime-config.mjs`), preflight de paquete, rollback
documentado = `ee843b3b`.

## PWA

La certificación física previa (v80 instalada en el Moto) sigue válida; v81 es
una actualización normal del ciclo del worker (los specs `pwa-update-lifecycle`
prueban exactamente ese camino). Manifest/install/standalone: sin cambios.

## SECURITY

0 service_role / 0 sb_secret / 0 refs staging en los 130 archivos servidos ·
secrets:scan PASS · RLS en 86/86 tablas de public · 225 SECURITY DEFINER con
search_path fijado · 0 escrituras anon (única volátil: watchdog acotado) · bucket
único privado · logs de auditoría reales (identity_audit_events 81 filas,
business_config_audit, command receipts). No se bajó ninguna guarda.

## PRODUCTION

- main `95ac129` = origin/main = base del worktree · ledger 112/112, última
  `20260819060000` · deployment vivo v80 sirviendo ese main.
- Trabajo de esta misión commiteado en la rama `feature/taba2-gondola-retail-final`:
  `629493f` (propuesta+lote+sheet) y `2048cca` (certificación+aplicadores gateados).
  SIN PUSH todavía; integración a main tras el GATE A.

## PHYSICAL GATES

- Moto G15 (ZY32LHS6PS) conectado y autorizado · rider de producción instalado
  (17/08 19:18) · PWA instalada previa vigente.
- Pendientes con Marco: GATE C (recepción real + primera venta con delivered+PIN).

## SAFETY

STOCK INVENTED = 0 · PRICES INVENTED = 0 (los 12 llevan los precios ya resueltos
del proposal; $0/$0 de delivery quedó señalado como decisión pendiente, no se tocó) ·
ALCOHOL ENABLED WITHOUT AUTH = NO (producción false; staging true documentado como
fixture ajeno, sin tocar) · ORDERS MODIFIED WITHOUT GATE = 0 (LT-0001 intacto) ·
SERVICE ROLE CLIENT = 0 · STAGING ACCIDENTAL WRITES = 0 (staging sólo leído) ·
FORCE PUSH = 0 (ningún push).

## EJECUTADO TRAS EL GATE (2026-08-21, autorización del dueño)

1. **Deploy v81 → LIVE**: merge ff main `95ac129 → 17638ea`; `wrangler pages deploy`
   proyecto la-taba, rama main, **5 archivos subidos / 209 conocidos por hash**,
   deployment `061d11fc`; en vivo: sw `la-taba-runtime-v81-gondola-legible`,
   runtime-config 789 B sha `ddee8a48…` byte a byte, módulo nuevo 200,
   `production:live` 7/7 OK; sonda v81: **33/33 tarjetas con litraje, 0 slugs,
   0 POST /auth/v1/signup al abrir el carrito**. Push main + rama a origin.
2. **Ensayo transaccional en producción**: las 24 filas entraron y el ROLLBACK dejó
   60/4/1 idénticos. **Apply 60 → 72**: 12 altas + 12 códigos fila por fila contra
   el plan, los 60 previos sin un campo cambiado, LT-0001 intacto, 16 códigos.
3. **Curación de sort_order**: 72 valores distintos (10..720), sólo esa columna;
   Coca-Cola Original = 2,25 L › 1,5 L › pack x12 › 500 ml › lata 354 ml.
4. **Limpieza**: borradas las 2 identidades anónimas de la auditoría (perfil
   verificado antes: anónimas, de hoy, 0 pedidos/membresías/sesiones/checkouts).
   Queda 1 anónima de hoy (05:35Z) dejada por la sesión Codex de la madrugada —
   fuera de la autorización, reportada, no tocada.
5. **Post-apply**: autoridad local a 72 (`catalog-skus.mjs`, `gondolaFinal:false`
   reconstruye los 60), contact sheet final de 72 regenerada
   (`artifacts/taba2-catalog-images/contact-sheet.{html,webp}`), descubrimiento
   de imágenes sobre los 72: **HIGH 5 · MANUAL_REVIEW 3 · SIN_CANDIDATO 27 ·
   SIN_FUENTE 37**. Los 12 nuevos: SIN_IMAGEN todos — Danone/ABI sin fuente
   programática; Coca-Cola 1,5 L y Cepita 1,5 L existen en la tienda Andina SÓLO
   como packs x4 (sello de pack sobre una unidad = prohibido). Cepita quedó
   incorporada a la allowlist del grupo Andina (clasificación honesta). Un HIGH
   nuevo apareció para `trapiche-origen-malbec-750ml` (vino, LICENSE GATE): se
   asocia cuando se abra el alcohol, no antes.
6. Góndola viva re-verificada tras todo: 33 comprables, alcohol cerrado, 6
   estantes, pack distinguible, 4 packshots + 29 fallback.

## SECUENCIA POST-GATE (el orden importa) — EJECUTADA arriba; queda la física

1. **Deploy v81** (cliente legible + sin identidades fantasma) — beneficia YA al
   catálogo actual de 33.
2. **Ensayo transaccional** del lote en producción (lote real + ROLLBACK).
3. **Apply del lote** 60→72 (`--aplicar --verificado-por=<owner>`).
4. **Curación de sort_order** (72 filas, sólo esa columna).
5. Actualizar `catalog-skus.mjs` a 72 (33+23+4+12) + regenerar contact sheet
   final + discovery de imágenes de los 12 (fuente aprobada: sólo sistema
   Coca-Cola vía tienda Andina; Danone/ABI no publican — fallback TABA).
   Asociación de imágenes que aparezcan = gate propio aparte.
6. Integración: merge fast-forward de la rama a main + push (main quedó en
   `95ac129`; la rama sólo agrega).
7. Gates físicos con Marco: Recepción real de mercadería (escaneo GTIN →
   publicar) y primera venta controlada con delivered+PIN.
