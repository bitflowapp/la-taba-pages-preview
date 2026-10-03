# TABA - Checkout, Perfil y Relay confiable

## Resultado

Veredicto: `TABA_CHECKOUT_RELAY_FUNCTIONAL_WORK_CERTIFIED_AND_COMMITTED`

- Rama: `feature/catalog-checkout-premium`
- Base: `4197bdbc1df7d3eb1328afc4a7a01e1067f14316`
- HEAD final: `41e27133849321cb65b61e14376d57c295cf5c2e`
- Estado final: limpio (`git status --short` sin salida)
- `git diff base..HEAD --check`: pasa

## Commits

1. `241f573 feat(checkout): use saved profile and addresses as checkout authority`
2. `4ab0888 test(e2e): align profile checkout focal with authority boundary`
3. `ba660af feat(realtime): make demo relay authoritative and recoverable`
4. `d248922 test(e2e): certify profile checkout and reliable demo synchronization`
5. `41e2713 test(e2e): keep relay restart harness portable`

Los commits 2 y 5 son correctivos explicitamente justificados. El primero fue necesario porque la certificacion desprendida del Commit 1 encontro dos specs E2E antiguos que aun buscaban inputs retirados. El quinto fue necesario porque el gate de higiene encontro una ruta de disco local hardcodeada en el test de reinicio del relay. No se uso `amend`.

## Auditoria y correcciones

- Se separaron autoridad de Perfil/checkout, relay confiable y E2E/harness.
- El checkout usa Perfil y direcciones guardadas; no recrea inputs retirados ni guarda Perfil al confirmar pedido.
- El relay conserva snapshot autoritativo, revision monotona, ACK, merge stale-safe, polling/lifecycle y persistencia TTL con clave.
- Showcase, customer delivery, business inbox, delivery code y tracking quedaron migrados al contrato vigente.
- La ruta local del harness se cambio a `os.tmpdir()` para conservar higiene portable.
- No se modificaron migraciones, RLS, Supabase ni procesos live.

## Certificacion por capa

### Commit 1 / Perfil y checkout

- `npm ci`: pasa.
- `npm run check`: pasa.
- `npm test`: `602/602` pasa, `0` fallos, `0` skipped, `14.5 s`.
- Focal corregido `tests/e2e/customer-delivery.spec.mjs`: `12/12` pasa, `16.5 s`.
- Cubre una, cuatro y diez direcciones; Perfil incompleto; sin direcciones; retorno a checkout; delivery/retiro; preservacion de carrito y seleccion.

### Commit 2 / Relay confiable

- `npm ci`: pasa.
- `npm run check`: pasa.
- `npm test`: `605/605` pasa, `0` fallos, `0` skipped, `13.6 s`.
- Focal temporal de realtime sobre el worktree desprendido: `9/9` pasa, `13.4 s`.
- Cubre autoridad, cliente tardio, stale publish, outage/retry, pageshow/focus/view recovery, key incorrecta, duplicados y reinicio real de estado.

### Commit 3 y correcciones / E2E

- `npm run check`: pasa.
- `npm test`: `605/605` pasa.
- Focal final de siete specs: `32/32` pasa, `49.5 s`, `0` retries.
- Suite completa 1: `111/111` pasa, `2.5 min`.
- Suite completa 2: `111/111` pasa, `2.5 min`.

## Gate final

- `npm run check`: pasa despues de corregir la ruta local del harness.
- `npm test`: `605/605` pasa.
- `npm run migrations:validate`: pasa.
- `npm run catalog:images:verify`: pasa.
- `npm audit --audit-level=high`: pasa.
- `git diff --check`: pasa.

## Aislamiento demo y showcase

- `showcase.spec.mjs` paso sus aserciones de `supabaseRequests === []`.
- Los focales de Perfil verifican requests Supabase vacias para cliente y negocio.
- El focal de reliability verifica `pageErrors === []`, `consoleErrors === []` y `supabaseRequests === []`.
- Los datos de las pruebas son sintéticos: clientes QA, pedidos QA, direcciones de Neuquen y productos sintéticos.
- No se observaron PII real, pageerror ni errores de consola atribuibles a la aplicacion.
- El relay de showcase no se usa para ocultar requests inesperadas; el escenario queda local y fail-closed.

## Escenarios de checkout

- 1 direccion: visible, seleccion predeterminada y delivery habilitado.
- 4 direcciones: listado compacto, expansion, seleccion por UI y default preservado.
- 10 direcciones: expansion completa, seleccion de direccion inicialmente oculta y sin overflow horizontal.
- Perfil incompleto: bloqueo, CTA a Perfil, sin confirmacion y retorno conservando carrito.
- Sin direcciones: bloqueo de delivery, CTA a Perfil y carrito conservado.
- Retorno desde Perfil: vuelve al checkout correcto y conserva carrito, modalidad y seleccion valida.
- Delivery/retiro: retiro sin direccion; la seleccion vuelve al regresar a delivery; no se muta el default.

## Backup

- Bundle: `C:\1212\backups\taba-checkout-relay-certified-41e2713.bundle`
- `git bundle verify`: pasa; historia completa.
- SHA-256: `8D741DF03081F557188909A48EA514E846697783323E8A9A6F9DD2B7407EFC80`

## Operacion y restricciones

- No se hizo `push`, `merge`, `rebase`, `reset`, `restore`, `stash`, `clean`, deploy ni amend.
- No se detuvieron procesos live; las pruebas usaron puertos aislados `18080/18887`, `18082/18889` y `18084/18891`.
- No se ejecutaron migraciones; solamente se ejecuto `migrations:validate`.

