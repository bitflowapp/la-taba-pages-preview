# Revisión independiente del PR #157 (v169 → v170) — 26/10/2026

**Dictamen: NO certificado.** Las correcciones de Codex resisten los ataques salvo los defectos de abajo, que quedaron corregidos y probados. Faltan la CI completa sobre el SHA final, el banco Docker con emulador, el despliegue en QA, R-MKT-1 y un reembolso real por API. No se tocó producción ni QA; no se empujó nada.

Base revisada: `a6f3455a` (PR #157). Esta rama: `review/v169-financial-audit-20261026`. Identidad de release: `la-taba-runtime-v170-payment-review` (v169 más estos arreglos; cambió el contenido firmado y el control exige un nombre nuevo).

## Defectos nuevos

| # | Gravedad | Defecto | Corrección | Prueba |
|---|---|---|---|---|
| 1 | P1 | Un reembolso ambiguo sin identidad del proveedor no tenía salida: «ejecutado» exige evidencia y «no ejecutado» estaba prohibido. Un pedido de reembolso que nunca llegó a Mercado Pago congelaba el pedido y todo reembolso nuevo, para siempre. | Migración `20261026040000`: `settle_ambiguous_refund_from_provider` (sólo service role: lista del proveedor leída completa, solicitud de más de 15 min, todo lo listado ya registrado con el mismo importe) y `request_refund_reverification` (dueño/admin). El worker la usa y reintenta con el backoff. Una nota nunca es evidencia. | `refund-ambiguity-recovery` (15), 5 mutaciones muertas, worker real F09 (3 escenarios), Deno (3 escenarios) |
| 2 | P1 | Conciliación: una página corta formada sólo por el instante del cursor seguía usando posición dentro del empate. 205 de 1.196 ventanas simuladas se cerraron con pagos sin ver. | `ledger-sweep.ts`: las páginas incompletas de un solo instante enumeran el instante exacto y avanzan por lo recibido. | `ledger-sweep-property.test.mjs` (6 modos; rojo en `a6f3455a`) |
| 3 | P2 | Una respuesta 200 que no era lista se leía como «sin reembolsos» (y es la prueba de ausencia). | `listPaymentRefunds` falla si no es lista. | Deno `unknown-list-not-a-list` |
| 4 | P2 | Dos pestañas verificando el mismo pago aprobado quitaban dos veces lo pagado y se llevaban lo agregado después (3 → 1 en vez de 3 → 2). | `mercadopago-return.js`: sólo la pestaña que toma el registro (bajo `navigator.locks`) retira las unidades. | unidad (2), e2e Chromium real (rojo con el código de Codex, verde con el arreglo) |
| 5 | Herramientas | El sustituto de `psql` de Codex imprimía JSON-texto sin comillas e ignoraba `\set VERBOSITY`: decenas de pruebas del worker no podían ejecutarse. Una prueba exigía un nombre de base fijo. La prueba de carrera de preferencias (`payment-preference-race-audit.deno.ts`) no estaba en ningún runner. | Adaptador corregido; nombre relajado; ambos Deno conectados a `test:webhook`. | `test:webhook` 70 + 262 |

## Lo que resistió

- **Claim de preferencias**: 8 sesiones SQL → 1 dueño; sin los candados → 5 (la prueba lo detecta). Handler real: 2, 8 y 24 solicitudes simultáneas → 1 POST. Respuesta perdida, 500, rechazo 400/401 y guardado fallido: nunca un segundo POST; la preferencia creada se recupera por búsqueda. Sin guarda de caducidad el claim se rechaza, y una autoridad cambiada lo rechaza sin mover el intento.
- **Guardas de `resolve_ambiguous_refund`**: ataques con listas de varias entradas (importe distinto, rechazado, en proceso mientras otra entrada sí coincide) rechazados; quitar el cotejo de ID mata 3 pruebas nuevas (sobrevivía a las de Codex).
- **Reembolsos concurrentes** con UUID distintos: 8 sesiones → una sola en vuelo; una solicitud con respuesta perdida bloquea a todas las demás.
- **Pagos pendientes** (`in_process`): ni pedido, ni stock, ni «rechazado»; aprobado después de vencer la reserva → un pedido y un descuento; rechazado → sin pedido ni reembolso.
- **Migraciones**: instalación limpia ≡ migración sobre base existente (507 funciones y privilegios idénticos); parches por texto válidos con finales de línea CRLF; propietario, `SECURITY DEFINER`, `search_path` y permisos conservados.
- **Aislamiento entre comercios**: 5/5 PostgreSQL + 250 casos Deno (OAuth, webhooks, separación de vendedores).

## Validación final (commit `b80d7f0c`)

| Suite | Resultado |
|---|---|
| `npm run check`, `migrations:validate`, `check:edge` | aprobados |
| Node (`npm test`) | 3.256 / 3.256 |
| Deno (`test:webhook`) | 70 + 262, 0 fallas |
| SQL por archivo (base nueva por archivo) | 21 de 24 archivos aprobados |
| e2e Chromium (checkout, retorno, combos, back-navigation, handoff) | 39 / 39, más 1 e2e nuevo de dos pestañas |
| e2e WebKit móvil (back-navigation, handoff) | 10 / 10 |

Los 3 archivos SQL que no pasan **no son de pagos**: `archive_bound_restore` y `backup_restore` necesitan `psql` y `pg_dump`, que este PostgreSQL embebido no trae; `ordering_verifier` falla igual sobre el esquema anterior a Codex.

## Pagos reales en QA (no se reconsultaron; evidencia de Codex)

LT-0185 (ARS 850) y LT-0186 (ARS 100) aprobados. El pago `185083342105` (ARS 350, OTHE) estaba `in_process / deferred_retry`, vigilado, con la reserva ya liberada; su estado final se desconoce. R-MKT-1 sigue sin ejecutarse: falta el segundo vendedor real.

## Riesgos pendientes

1. Un despachador de preferencias que muere tras el claim deja al comprador esperando hasta que vence el checkout (15 min) y empieza otro. No se desbloquea automáticamente: la incertidumbre es real.
2. Los visitantes sin sesión no ven combos: `get_mercadopago_checkout_availability` es sólo para usuarios autenticados. Ya era así antes de Codex; la salida de fondo es una migración que la conceda a `anon`.
3. Un grupo de más de 10.000 pagos con el mismo instante no se cierra (a propósito).
4. La verificación de permisos rechaza los scopes explícitos `refunds|cancel/read-only`; no puede probar un permiso positivo, porque Mercado Pago sólo publica `read`, `write` y `offline_access`.
5. Las pruebas SQL de `tests/db/` no corren en ninguna CI. Recomendación: un job con el PostgreSQL de ubuntu-latest (`TABA_PG_BIN`), en una decisión aparte.

## Orden de despliegue en QA (cuando se autorice)

1. Migraciones `…010000`, `…020000`, `…030000`, `…040000`, en ese orden.
2. Funciones: `mercadopago-create-preference`, `mercadopago-payment-worker`, `mercadopago-refund` y lo compartido. Sin `…020000` el handler nuevo falla cerrado; sin `…040000` el worker reintenta con ruido.
3. Cliente v170 completo (evitar mezclas de módulos).
4. Una sola CI de GitHub sobre el SHA final.
5. Pendiente externo: R-MKT-1 y un reembolso real con permisos efectivos.
