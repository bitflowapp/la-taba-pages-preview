# Estado del go-live · por qué no se abrió, y qué falta

**Veredicto: `TABA GO-LIVE BLOCKED`.**

Dos causas. Ninguna es técnica: las dos son decisiones que no me corresponden.

## Causa 1 · El catálogo son precios reales de un comercio real

Marco pidió explícitamente: «Reportar antes de aplicar: producto → precio →
stock inicial». Está en `CATALOG-PRODUCTION.md`: cuatro bebidas, precios
tomados exactos de la autoridad del repo, stock 8.

**Nada aplicado.** Falta el visto bueno.

## Causa 2 · `ordering_verified_by` tiene que ser una persona, y no puedo firmar por Marco

La vitrina exige **las dos banderas**: `ordering_enabled` y `ordering_verified`.
Y el CHECK `businesses_ordering_verified_configuration` no deja poner
`ordering_verified = true` sin `ordering_verified_at` **y**
`ordering_verified_by`, que es una FK a `auth.users`.

O sea: **el contrato exige que una persona con nombre firme que la configuración
comercial está bien.** No hay valor `system`, no hay nulo, no hay escapatoria.

Y busqué una superficie de producto para hacerlo: **no existe**. Ningún RPC
escribe `ordering_verified` —el único lugar donde aparece escribiéndose es la
migración que lo pone en `false`—. Ni el Panel ni ninguna pantalla lo ofrecen.
Es un gate manual, por diseño.

Consecuencia: **Marco tampoco puede abrirlo desde el Panel.** La apertura es
necesariamente una escritura administrativa, y la única firma honesta posible es
la suya, porque es el dueño y es quien decide abrir.

Lo que necesito es que lo diga: *«verifico la configuración y autorizo que
`ordering_verified_by` sea mi cuenta»*. Con eso escribo su id, que sería
**verdad** —él es el que verifica y autoriza—, y no una suplantación.

Sin esa frase no lo escribo, por la misma razón por la que no aprobé al Rider
por SQL.

## Lo que ya está listo y no depende de nadie

* preflight completo (`PRE-GO-LIVE.md`): ledger 107, 0 sin RLS, 0 residuo QA,
  scheduler vivo, 0 pedidos;
* host y paquete productivos verificados (`CUSTOMER-SMOKE.md`);
* Rider aprobado y operativo (`RIDER-STATUS.md`);
* el pago resuelto sin cobrar ni configurar nada (`PAYMENT-POSTURE.md`);
* la dirección real encontrada en el contrato de ubicación, no inventada
  (`BUSINESS-CONFIG.md`);
* el catálogo elegido con precios que ya existían.

## La secuencia que queda, cuando Marco confirme

1. escribir configuración comercial: `ARS`, huso, `delivery_enabled`,
   `delivery_fee=0`, mínimo `0`, dirección `Mendoza 827, Neuquén`;
2. importar los cuatro productos con `import-product-catalog.mjs`;
3. **dry-run del checkout** sin crear pedido;
4. `ordering_verified = true` con la firma de Marco + `ordering_enabled = true`;
5. read-back desde producción, no desde la respuesta de escritura;
6. navegador real: que desaparezca «Pedidos no disponibles» y aparezcan
   productos, precios, agregar, carrito y checkout;
7. **STOP** — el primer pedido lo hace Marco.

## Gates que quedan abiertos y hay que decir en voz alta

| | |
|---|---|
| **SMTP** | `TEAM SELF-REGISTRATION = SMTP GATED`. El owner y el Rider actuales operan; **altas nuevas de equipo y recuperación de contraseña no** |
| **CAPTCHA** | no integrado. Con la persiana cerrada no importaba; **abierta pasa a P1 inmediato** |
| **horarios y zonas** | enforcement en `false`: acepta pedidos a cualquier hora y a cualquier distancia. **P1 antes de publicitar** |
| **pin del local** | `human_verified: false` a ±20 m. **P2**, tarea física |
