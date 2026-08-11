# Certificación del mapa con un pedido REAL: lo verificado y lo que falta

Objetivo: una compra real de staging que atraviese storefront → checkout →
Panel → Rider físico en la Moto G15 → recorrido con GPS real → `delivered`, con
el cliente mirando «Seguir» todo el tiempo.

**No está certificado.** El tramo físico —Moto G15 en la calle, ≥300 m, GPS
real— necesita a una persona con el teléfono, y las credenciales de Panel y
Rider no están en esta máquina. Abajo está exactamente qué quedó verificado, qué
falta y con qué comando se hace cada cosa.

## 1 · Preflight — lo verificable desde acá

| Ítem | Estado | Dato |
|---|---|---|
| deployment sigue en `1d26c4b` | ✅ | `8241b56f-532c-41ba-8482-ef96a3299549`, Production/`staging` |
| artefacto servido | ✅ | `la-taba-runtime-v61-cliente-comercial-mapa-permanente` |
| `runtime-config.js` vivo | ✅ | 684 B, sha256 `57d8a007…`, sin cambios |
| **Mercado Pago en TEST** | ✅ | `{ok:true, available:true, environment:"test", checkoutMode:"checkout_pro"}` |
| pedidos online habilitados | ✅ | `deliveryEnabled` y `pickupEnabled`, `orderingDetailsVerified` |
| producto seguro con stock | ✅ | 8 comprables; Speed Unlimited $2.925, stock 69 |
| mínimo de delivery | ✅ | $350 · envío $150 · total del ensayo $3.075 |
| efectos económicos reales | ✅ | ninguno: MP en sandbox, no se confirmó ningún pedido |
| lock de staging | ✅ | libre (`CERRADO_CERTIFICADO`) |
| rollback disponible | ✅ | `c184ffb6-325e-44d1-8c2e-3ae245b09d50` (`399d0cc`, v60) |
| gates | ✅ | `npm run check` · 1324/1324 |
| HEAD / deployment sin cambios inesperados | ✅ | local `b072287`, árbol limpio; desplegado `1d26c4b` |

**No verificable desde acá:** fiscal real deshabilitado, Moto G15 conectada,
sesión Rider QA válida. Los tres los cubre `preflight-gate.mjs`, que se planta
pidiendo `TABA_SECRETS` —la carpeta de credenciales de la máquina que opera— y
no adivina. Esa variable no está definida en este entorno.

## 2 · Cliente sin pedido — hecho

Sesión nueva, sin comprar nada, entrando a «Seguir» por la barra inferior:

```json
{ "mapaVisible": true, "lienzo": true, "rider": 0, "destino": 0, "eta": false,
  "recentrar": 0, "bottomNav": true, "estado": "idle",
  "pildora": "La Taba · Cobertura no publicada" }
```

0 errores de consola · 0 respuestas 4xx/5xx.
Captura: `artifacts/ci/staging-v61/pedido-real/BEFORE-seguir-sin-pedido-390.png`

## 3 · Ensayo del camino de compra — hecho, sin crear el pedido

`node scripts/primer-pedido-humano/ensayo-storefront.mjs` recorrió el camino del
cliente en el sitio publicado y **se plantó antes de confirmar**:

- 8 tarjetas de producto, 0 errores de JS;
- «Speed Unlimited» agregado al carrito (sólo local, todavía no hay pedido);
- mínimo alcanzado, total $3.075;
- formas de pago ofrecidas: A coordinar · Efectivo al recibir · Transferencia ·
  **Mercado Pago — Tarjeta, débito o dinero en cuenta**;
- lo que la persona tiene que completar: **nombre y teléfono** en Perfil, y una
  **dirección con el punto confirmado**.

O sea: el camino existe y está sano. Lo que falta es lo que sólo puede poner una
persona.

## 4 · Lo que falta, y por qué no lo puedo hacer yo

| Paso | Bloqueo |
|---|---|
| 3 · compra real con MP TEST | Checkout Pro redirige a Mercado Pago y pide la cuenta **comprador de prueba**. No la tengo y no se inventa. |
| 4 · Panel → preparing/ready | Necesita `la-taba-staging-business-login.txt` en `TABA_SECRETS`. |
| 5 · Rider claim → pickup → on_the_way | Necesita `rider-map-qa-login.txt` **y la Moto G15 física**. |
| 6 · recorrido ≥300 m con GPS real | Necesita una persona caminando. No hay forma de sustituirlo sin falsear GPS, que el encargo prohíbe. |
| 8 · reconnect | Depende de 5 y 6. |

## 5 · Runbook para la corrida física

Precondición: `TABA_SECRETS` apuntando a la carpeta de credenciales, Moto G15
con **datos móviles** (sin eso no hay seguimiento en vivo), y tomar
`taba2-staging-mutation.lock`.

```bash
cd scripts/primer-pedido-humano

# 0 · los 16 chequeos antes de tocar el teléfono
node preflight-gate.mjs

# 1 · foto de staging antes de mutar nada
node snapshot.mjs

# 2 · la compra la hace una PERSONA en el teléfono, en el sitio publicado:
#     Perfil → nombre y teléfono → dirección con el punto confirmado en el mapa
#     → carrito → Mercado Pago (TEST) → confirmar.
#     El pedido entra con origin='production'; los QA sembrados son origin='qa'.
node esperar-pedido.mjs          # engancha el pedido y canta su código

# 3 · el negocio lo lleva por sus estados reales, desde su Panel
node panel-abierto.mjs           # deja el Panel abierto y con sesión
#     (o node panel-operar.mjs LT-XXXX --hasta-listo)

# 4 · vigilancia en vivo durante toda la entrega
node monitor.mjs LT-XXXX

# 5 · el Rider toma el pedido y retira, desde la app en la Moto
node cola-rider.mjs              # qué ve el rider, preguntado con SU sesión
node verificar-presencia.mjs LT-XXXX   # con el Rider parado en el local

# 6 · el recorrido. Caminar; detenerse para tocar el teléfono, nunca conduciendo
node medir-movimiento.mjs LT-XXXX      # ventana de 4 min, MINUTOS=6 para más
node gps-vivo.mjs LT-XXXX              # ¿está publicando GPS real, ahora?
node timeline-fixes.mjs LT-XXXX        # captura contra llegada, y desorden

# 7 · cierre en la puerta, desde el Moto
pwsh llegada-y-codigo.ps1
pwsh entregar.ps1

# si algo sale mal
node rollback.mjs LT-XXXX              # diagnostica y dice el camino exacto
```

### Qué mirar en el cliente durante la corrida

Con «Seguir» abierto en la sesión que compró, en cada transición:

- `idle` → `preparing` → `on_the_way` → `delivered`: **el mapa en los cuatro**, y
  el mismo lienzo, no una pantalla distinta;
- sin rider dibujado hasta que haya una ubicación real autorizada;
- en `on_the_way`: que el marcador **no salte hacia atrás**, no se quede una
  cuadra atrás de forma persistente y no reproduzca fixes viejos —es el defecto
  histórico que cerró `7cb20e0`—;
- en `delivered`: mapa + resumen, **sin** «ubicación no disponible» y **sin**
  botón de recentrar;
- contrato público intacto: 4 decimales, `captured_at` autoritativo, sin
  historial público, sin datos privados.

## 6 · Lo que no se tocó

Producción, backend, migraciones, ARCA, dinero real, `LT-0030`, pedidos humanos.
No se creó ningún pedido: el ensayo se planta antes de confirmar. No se dejó
ninguna sesión ni fixture QA activo. Sin push.
