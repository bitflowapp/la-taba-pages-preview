# Mercado Pago comercial: vinculación de comercios lista para Walter

24/10/2026 · rama `feature/mp-commercial-onboarding-20261024`, apilada sobre `release/commercial-readiness-20261023`
(#150 → #149 → #148). Sin producción, sin dinero real, sin servicios pagos, sin merge.

- [`CONECTAR-WALTER.md`](CONECTAR-WALTER.md) — el procedimiento del día que Walter acepte (y qué hacer si autoriza la cuenta equivocada).
- [`PRODUCCION.md`](PRODUCCION.md) — QA vs producción, secuencia P1–P10, lo que exige la sesión del dueño de La Taba Delivery, riesgos abiertos.
- [`qa/`](qa/) — evidencia del despliegue y las pruebas alojadas de hoy.

## 1. Auditoría dirigida: lo que ya estaba bien (no se tocó)

OAuth con PKCE S256 y `state` aleatorio de un solo uso (10 min, hash en la base, borrado al consumir); el callback
revalida la sesión del Panel y el rol (dueño/encargado) antes de canjear el código; tokens sellados con una clave por
proyecto/entorno/aplicación/comercio; renovación con lease y sin reemitir un refresh ambiguo; sólo `invalid_grant`
pide reconectar; `test_user`/`live_mode` separan prueba de producción; la integradora de otro entorno se rechaza antes
del consentimiento; `unique (environment, seller_id)` impide que una cuenta cobre para dos comercios; un comercio no
cambia de cuenta receptora; desvincular pausa los cobros y se niega con operaciones pendientes; el webhook exige
HMAC y confirma el ruteo leyendo el pago con el token del vendedor; el panel nunca muestra tokens ni números de
vendedor. Todo eso tiene pruebas y estaba verde.

## 2. Defectos encontrados y corregidos

| # | Defecto (reproducible) | Consecuencia | Corrección |
|---|---|---|---|
| D1 | En producción, autorizar con **la cuenta dueña de La Taba Delivery** (p. ej. Marco probando con su sesión abierta) se guardaba como vendedor del comercio | Las ventas de Walter se cobrarían en la cuenta de La Taba, y el vínculo **no se puede cambiar** después | El callback la rechaza antes de guardar (`integrator_account`); la verificación la marca (`seller_is_integrator`) y el cobro se niega (`PAYMENTS_NOT_ENABLED`). Sólo producción: en QA la integradora es del propio vendedor de prueba, a propósito |
| D2 | Una cuenta que ya cobra para **otro comercio** terminaba en «No pudimos completar la vinculación» | El dueño no sabía qué hacer | El callback distingue la violación de `unique (environment, seller_id)` → `seller_in_use`, con su mensaje |
| D3 | El panel decía «¿No es la cuenta que querías? **Desvinculá y volvé a conectar** con la correcta» | Falso: el servidor rechaza el cambio de vendedor aun desvinculado (regla de `20260905195357`). Un dueño que siguiera la indicación quedaba trabado | Texto corregido (el cambio lo hace soporte) y **salida de soporte** nueva: `mp_release_unused_seller_binding` (migración `20261024120000`), sólo `service_role`, sólo si el comercio está desvinculado, se nombra el vendedor exacto y **no tiene ningún intento de pago ni aviso**. La regla general no cambia |
| D4 | «Listo: la cuenta quedó vinculada» se mostraba con sólo releer el estado | La confirmación no venía de una verificación | Al volver de Mercado Pago el panel pide **una** verificación real (identidad, permisos, integradora, cuenta de La Taba) y recién con ella dice «Mercado Pago confirmó la cuenta»; si algo frena el cobro lo dice |
| D5 | `seller_changed` decía «ya registró **cobros** con otra cuenta» aunque no hubiera cobros | Mensaje inexacto | «ya quedó vinculada con otra cuenta… no se cambió nada» |
| — | Aviso previo al consentimiento: «Entrá con la cuenta de Mercado Pago del comercio… si ya hay otra cuenta abierta, cerrala» | Previene D1/D3 | Agregado a la tarjeta sin vincular |

No se cambió la lógica financiera validada (reservas, intentos, webhooks, conciliación, devoluciones). El único
cambio en el camino de cobro es un rechazo adicional (D1) que no aplica en QA.

## 3. Pruebas

| Qué | Resultado |
|---|---|
| Deno, funciones de pago (`npm run test:webhook`) | ver `qa/RESULTADOS.md` |
| Unitarias de Node (`npm test`) | ver `qa/RESULTADOS.md` |
| Regresiones nuevas: 4 del callback (cuenta de La Taba en producción, cuenta real distinta, misma cuenta en prueba, cuenta de otro comercio), 1 de verificación, 3 del panel, 14 pgTAP de la liberación | verdes; **mutaciones**: sin el arreglo fallan 3 de Deno y 2 de pgTAP |
| Ensayo de producción simulada: binding de `bind-production.mjs` sobre una copia con un ref ficticio → conectar, callback, verificar | `node scripts/production/rehearse-mp-onboarding.mjs` (ver `qa/RESULTADOS.md`) |
| pgTAP canónico | 960 aserciones planificadas (946 + 14); el shim local no implementa varias funciones de pgTAP, la corrida completa es la de CI |
| **QA alojado** (`ixewllzzuzpqrkxzmfzx`): migración aplicada (libro 173→174, jobs reactivados), 8 funciones desplegadas, compuertas de autenticación, 6 webhooks falsificados rechazados | PASS (`qa/despliegue-qa.jsonl`, `qa/verify-functions-gates.jsonl`, `qa/forged-webhooks.json`) |
| **QA alojado, OAuth real**: el comercio QA B pidió el enlace y el vendedor de prueba que ya cobra para A consintió en Mercado Pago | callback 303 → `seller_in_use`; B sigue sin vínculo; A sigue conectado con el mismo vendedor y verificado (`qa/01…03`) |
| Verificación real de A con el código nuevo | identidad, permisos e integradora OK; `seller_is_integrator: false` (exención de QA correcta); cobro `payments_not_enabled` |

No se publicó el sitio de QA (lo usa la sesión de UX): el texto nuevo del panel está probado en Node, no en el
preview alojado.

**No ejecutado (no lo declaro verificado):** un pago marketplace con integrador ≠ vendedor (G1); el vendedor B de
prueba; reembolso por API; disputas; cualquier cosa en producción.

## 4. GO / NO-GO de Mercado Pago

| Ámbito | Veredicto | Por qué |
|---|---|---|
| **Código de vinculación comercial** | **GO** | flujo completo, mensajes, verificación real al volver, guardas de cuenta equivocada, salida de soporte; probado en Node/Deno/pgTAP y en QA alojado con OAuth real |
| **Vincular la cuenta de Walter** | **NO-GO hasta P1–P9** | no existe el proyecto de producción (D1, pago); falta la sesión del dueño de La Taba Delivery (Client Secret renovado, callback y webhook del proyecto nuevo) |
| **Cobrar con dinero real** | **NO-GO** | además: llave final, autorización de Walter para el cobro y la devolución de control (D5) y R-MKT-1 sin ejecutar |

## 5. Autorizaciones y recursos que faltan (exactos)

1. **D1 — proyecto de producción pago** en Supabase (Luna Systems): crear y facturar. *Servicio pago.*
2. **D2 — dominio / proyecto de Pages de producción** (hoy `la-taba.pages.dev`).
3. **Sesión del dueño de La Taba Delivery** (`7677852968049976`): renovar el Client Secret; registrar callback y
   webhook del proyecto nuevo; revelar la clave del webhook (`PRODUCCION.md` §3).
4. **Consentimiento de Walter**: que él autorice su cuenta en P10, en su dispositivo.
5. **G1 (opcional, recomendado)**: crear un segundo vendedor de prueba en TestApp-ae01fd1d para ejecutar R-MKT-1 sin
   dinero real (`MARKETPLACE-SEGUNDO-VENDEDOR.md`). Irreversible (las cuentas de prueba no se borran).
6. **D5 — Walter**: importe y producto del primer cobro real y de la devolución de control.
7. **Revisión y merge** de #148 → #149 → #150 → este PR.
