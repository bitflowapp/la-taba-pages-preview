# Activación comercial de Mercado Pago: el procedimiento del día que Walter autoriza

**Actualización 30/10:** procedimiento histórico. Usar [PREFLIGHT.md](../mp-closure-20261030/PREFLIGHT.md): faltan certificaciones humanas y habilitación productiva; no pasar de una devolución externa a declarar aprobada la API ni abrir pagos públicos sin aprobación separada.

Una página. Todo lo de ingeniería está hecho; lo que sigue son autorizaciones y cargas de titulares, cada una con su
comprobación automática. Ninguna cobra dinero hasta el paso 9, y el paso 9 lo autoriza Walter.

```bash
node scripts/mercadopago/asistente-activacion.mjs            # dónde estamos (P1–P11)
```

| # | Paso | Quién | Comprobación (sale 0 si está bien) |
|---|---|---|---|
| 1 | Crear el proyecto de producción (plan pago, `sa-east-1`) y completar el binding con `bind-production.mjs` (PR + CI verde) | Marco · ingeniería | `asistente-activacion.mjs estado` → P1 y P2 «hecho» |
| 2 | Esquema y funciones: `deploy.mjs bootstrap --apply --confirm <ref>` y `deploy.mjs functions all --apply --confirm <ref>` | ingeniería | `node scripts/production/deploy.mjs gates` |
| 3 | En Mercado Pago Developers (sesión del dueño de **La Taba Delivery**): renovar el Client Secret **conservando el Client ID**; registrar la Redirect URL `https://<ref>.supabase.co/functions/v1/mercadopago-oauth-callback` y el webhook `https://<ref>.supabase.co/functions/v1/mercadopago-webhook` con «Pagos» y «Vinculación de aplicaciones»; copiar la clave del webhook | dueño de La Taba Delivery | `asistente-activacion.mjs integradora` (pide el Client Secret oculto): dueña real, `MLA` |
| 4 | Cargar los secretos **sin** la llave final: `configurar-oauth-produccion.ps1`, `sincronizar-worker-hmac.mjs --target=production --apply` y `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved` | Marco | `verificar-configuracion.mjs --ref=produccion --esperado=disabled` y `asistente-activacion.mjs webhook-firma --confirm <ref>` (pide la clave oculta) → «clave_coincide» |
| 5 | Publicar el sitio contra el proyecto nuevo (`Deploy production`) | ingeniería | `asistente-activacion.mjs red` → 9/9 |
| 6 | Ensayo sin dinero sobre el mismo código | ingeniería | `asistente-activacion.mjs ensayo` → banco 17/17 y alta OK |
| 7 | **Walter vincula su cuenta**: Panel → Configuración → Mercado Pago → Conectar, autoriza **con la cuenta de su comercio** (si hay otra sesión abierta de Mercado Pago, cerrarla antes) y vuelve verificado | Walter, en su dispositivo | el Panel dice «Mercado Pago confirmó la cuenta» y «Verificar» sólo marca «cobro apagado» (`payments_not_enabled`) — [`CONECTAR-WALTER.md`](../mp-commercial-onboarding-20261024/CONECTAR-WALTER.md) |
| 8 | Con la autorización de Walter para el cobro de control: cargar **la llave final** `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` y **después** encender el cobro del comercio (en ese orden: sin la llave, el checkout se niega antes de reservar stock) | operador | `cobro-negocio.mjs encender --target=production --business=<uuid> --confirmar=<slug> --revision-aprobada`; `verificar-configuracion.mjs --ref=produccion --esperado=production` |
| 9 | **Cobro real de control** (importe y producto que fija Walter) y **devolución de control** | Walter + operador | [`LANZAMIENTO.md` §5–§6](../commercial-readiness-20261023/LANZAMIENTO.md): pago con el cobrador correcto → webhook **201** ruteado al comercio (cierra R-MKT-1) → un pedido y un movimiento de stock → devolución conciliada una vez |
| 10 | Apertura gradual 5 → 15 → 30 clientes | Walter | `ops-pulse.mjs --target production --hours 2` después de cada cobro |

## Si algo sale mal

```bash
node scripts/mercadopago/asistente-activacion.mjs reversion --business <uuid> --slug <slug>
```

Siete niveles, del más fino al más grueso: apagar el cobro del comercio (efectivo sigue) → sacar la llave final →
sacar la revisión productiva (todo falla cerrado) → desconectar el vendedor → funciones/migración anteriores → sitio
anterior → restauración. Apagado inmediato ante: pago al vendedor equivocado, pago sin pedido que no se puede rearmar,
cobro o reembolso duplicado, firma inválida aceptada, credencial expuesta.

## Qué no hace falta programar para lanzar

Nada. Lo único que no existe en el código es la **comisión del marketplace**, porque el modelo vigente no la cobra; si
se decidiera, es un cambio acotado (monto fijo en ARS calculado en el servidor, `marketplace_fee` en la preferencia) y
del lado de Mercado Pago exige KYC nivel 6 del vendedor y coordinar la liberación con su ejecutivo comercial.
