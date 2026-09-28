# Abrir La Taba: runbook

Pasos para pasar La Taba real de «cerrada y sin productos» a «tomando pedidos», sin tocar código. Casi todo se hace desde el **Panel** (`https://la-taba-commercial-pilot.pages.dev/#business`). La terminal queda para dos cosas:

- la verificación de plataforma, que hace el operador de La Taba;
- opcionalmente, la carga masiva con planilla.

Los datos que hay que pedirle al comercio están, todos juntos, en [`catalog/opening/OWNER-INPUT.md`](../catalog/opening/OWNER-INPUT.md). **Nada de este documento inventa un precio, un horario, un costo de envío ni una dirección.**

## Antes de empezar: qué falta, en un solo lugar

- **En el Panel:** Panel › **Apertura** (Preparar apertura). Muestra cada paso con ✓ o ✗, qué falta y un botón para ir a completarlo.
- **En la terminal** (operador): es la misma lista, más las pruebas técnicas.

  ```
  npm run opening:check                      # termina con TECHNICAL_READY / COMMERCIAL_READY / CAN_OPEN
  npm run opening:check -- --min-products 5  # el canary pide al menos 5 productos
  ```

Las dos leen la misma respuesta de la base (`get_store_opening_readiness`). Si una compuerta aparece en un lado, aparece en el otro.

## Quién hace qué

| Paso | Quién | Dónde |
| --- | --- | --- |
| Fotos, precios, stock, publicación | Dueño o encargado | Panel › Catálogo (o la planilla) |
| Horarios, retiro, delivery, zonas, envío, datos del local | Dueño o encargado | Panel › Horarios y cobertura |
| Sumar repartidores, equipo o un dueño | Dueño (encargado: sólo equipo y repartidores) | Panel › Equipo |
| Conectar Mercado Pago | El dueño **comercial**, con su cuenta | Panel › Conectar Mercado Pago |
| Verificación de plataforma | Operador de La Taba | `npm run opening:approve` |
| Abrir, pausar, reanudar, cerrar | Dueño o encargado (pausar/abrir: también el equipo) | Panel › Abrir el negocio |

### Walter como dueño, Marco como encargado técnico

1. Marco (dueño técnico hoy) va a Panel › **Equipo** › Invitar y completa:
   - nombre: Walter;
   - correo de Walter;
   - rol: **Dueño**;
   - la frase `INVITAR DUEÑO`.
2. Crea la invitación y le manda el link por WhatsApp (botón «Mandar por WhatsApp»). El link:
   - sirve una vez;
   - sólo sirve para ese correo;
   - vence en 2 días.
3. Walter abre el link y escribe su correo.
   - Si es una cuenta nueva, elige su contraseña: 12 o más caracteres, y no puede ser una filtrada.
   - Si ya tenía cuenta, entra con ella.
   - La invitación queda aceptada.
4. Walter entra al Panel. Desde Equipo le cambia el rol a Marco: **Encargado**, con la frase `QUITAR DUEÑO`.
   - La base nunca deja al comercio sin dueño (`last_owner`).
   - Marco conserva catálogo, horarios, pedidos, pagos e invitaciones de equipo y repartidores.
   - Pierde: otorgar dueño o encargado, autorizar lo fiscal y operar entregas como dueño.
5. Walter conecta **su** Mercado Pago (§8).

## 1. Fotos

Cada producto necesita una **foto aprobada** para publicarse. Es una regla de la base para el comercio real.

1. Sacar las fotos siguiendo [`catalog/photo-capture/README.md`](../catalog/photo-capture/README.md).
   - Nombre de cada archivo: `<sku>__front.jpg`. El SKU exacto está en esa tabla y en la planilla.
2. Panel › Catálogo › **Cargar fotos en lote**:
   - elegir todas las fotos → «Revisar archivos»;
   - la lista dice cuáles se suben y por qué no las otras (nombre, SKU desconocido, repetida, producto publicado);
   - «Subir N fotos para revisión».
3. Aprobar cada foto: en cada producto, «Imagen» → «Vista previa privada» → Derecho de uso **Foto propia del negocio**, con una referencia (por ejemplo, «foto propia 2026-10-01»).
   - Subir una foto **nunca** la aprueba sola.

Para cambiar la foto de un producto ya publicado:

1. «Cambiar foto o ficha (vuelve a borrador)». El producto deja de verse en la tienda.
2. Subir la foto nueva y aprobarla.
3. «Verificar ficha y publicar».

## 2. Precios

- **Desde el Panel:** Catálogo → escribir el precio → «Guardar», o «Guardar cambios de la lista» para varios a la vez. Cargar un precio lo confirma.
- **Con planilla** (muchos productos juntos):
  1. Completar `catalog/opening/planilla-apertura-cp.csv` (columnas `precio`, `stock`, `publicar`; ver [`catalog/opening/README.md`](../catalog/opening/README.md)).
  2. Probar sin escribir: `npm run opening:dry-run`. Dice qué cambia y qué seguiría faltando.
  3. Aplicar con la sesión del dueño o encargado, en **una** transacción que es todo o nada:

     ```
     npm run opening:publish -- --apply --credential "<credencial del dueño o encargado>"
     ```

     Pide escribir `APLICAR`. Repetirla no cambia nada: la segunda vez no hay nada que aplicar.
- Cambiar el precio de un producto publicado lo mantiene publicado. La base lo re-verifica en el mismo paso.

## 3. Stock

- Vacío = **sin contar**; `0` = **contado y agotado**; un número = unidades contadas. Nunca se inventa: un producto sin contar no se publica.
- Se carga en Catálogo (o con la planilla). Durante el día, lo descuenta cada venta.
- Un producto que llega a 0 deja de estar disponible solo. Al reponer, se vuelve a publicar con «Publicar y habilitar».
- **Ocultar** un producto sin tocar el stock: «Ocultar de la tienda». Así se maneja la disponibilidad del comercio, que no es lo mismo que el stock.

## 4. Horarios

Panel › Horarios y cobertura › **Horario de atención**.

- Por día: hora de apertura y cierre → «Agregar tramo». Hasta 4 tramos por día. Un día sin tramos queda **cerrado**.
- Un tramo que termina antes de empezar cruza la medianoche. Por ejemplo, 20:00–02:00.
- «Abrir las 24 horas» carga los siete días completos.
- **«Guardar horarios»** guarda la grilla para retiro **y** para delivery a la vez.
- El horario ya se exige en el comercio real. Sin horario, la tienda rechaza todos los pedidos.

## 5. Retiro

1. Panel › Horarios y cobertura › **Cómo entregás** → tildar «Retiro en el local» → Guardar.
2. **Datos del local** → dirección → «Guardar dirección». Con retiro, la dirección es obligatoria: es adonde va el cliente.
3. Opcional, recomendado: WhatsApp del local + «Confirmo que es el WhatsApp del local» → Guardar. Sin confirmar, la tienda no lo muestra.

Sólo retiro es la forma más simple del canary: no hace falta zona, costo de envío ni repartidores.

## 6. Delivery

1. «Cómo entregás» → tildar «Delivery».
2. **Envío y pedido mínimo del comercio**: los dos valores son obligatorios con delivery. Si no hay mínimo, poner `0`.
3. **Zonas de entrega**: nombre del barrio o zona, más envío y mínimo propios si difieren. Agregar zona.
   - La exigencia de zonas ya está encendida. Sin una zona activa, el delivery no llega a ningún lado.
4. **Quién entrega**: repartidores (§7) o el propio local. Sin repartidores, el local cierra la entrega con el código del cliente, así que los repartidores no son obligatorios.

## 7. Riders

1. Panel › Equipo › Invitar → rol **Repartidor** → «Crear invitación» → mandar el link.
2. El repartidor abre el link, crea su cuenta con **ese** correo y elige su contraseña.
3. Instala la app de repartidor. Ver **RIDER_INSTALL_PATH** en [`docs/TEAM-APPS-DISTRIBUTION.md`](TEAM-APPS-DISTRIBUTION.md).
4. Entra en la app con su correo y contraseña → «Disponible».

Otra forma: la persona crea su cuenta en el Panel → «Repartir pedidos» → «Pedir acceso», y el dueño aprueba en Panel › Solicitudes. Sin SMTP, esa cuenta necesita el enlace del operador, así que la invitación es el camino recomendado.

Para dar de baja a un repartidor: Equipo › «Desactivar». Sus sesiones se cierran y no puede entrar.

## 8. Pago

- **Efectivo y transferencia**: siempre disponibles, sin configurar nada.
  - En el checkout aparecen «Efectivo al retirar o recibir» y «A coordinar con el local».
  - El local pasa su alias o CBU por WhatsApp.
  - Al cobrar, en el pedido: «Registrar efectivo recibido» o «Registrar transferencia recibida».
- **Mercado Pago**, sólo cuando Walter conecte **su** cuenta:
  1. Walter entra a Panel › Conectar Mercado Pago → «Conectar Mercado Pago» → autoriza en Mercado Pago.
     - El Panel muestra el estado: No conectado, Conectando, Conectado, Requiere reconexión o Bloqueado.
  2. Queda «Bloqueado» hasta que la plataforma lo habilite, con la revisión productiva y el consentimiento de Walter:

     ```
     node scripts/mercadopago/cobro-negocio.mjs encender --revision-aprobada ...
     ```

  3. Antes del primer cobro real: [`docs/REAL-PAYMENT-CANARY-RUNBOOK.md`](REAL-PAYMENT-CANARY-RUNBOOK.md).
  - La tienda **no ofrece** Mercado Pago mientras no esté conectado y habilitado.
  - La cuenta de Marco **no** es la vendedora.

## 9. Verificación de plataforma

Es el paso que habilita los pedidos online. Qué es cada cosa:

| | Quién lo escribe | Cuándo | Qué verifica | Operación |
| --- | --- | --- | --- | --- |
| `ordering_verified` | **Sólo la plataforma** (clave de servicio). Ninguna persona tiene permiso de escritura | Cuando todo lo demás está en ✓ | Todas las compuertas obligatorias de «Preparar apertura»: comercio activo, moneda, cómo entrega, horarios de cada canal, dirección si hay retiro, envío, mínimo y zona si hay delivery, precios, stock, fotos y publicación. Además, el CHECK de la base | `platform_verify_business_ordering` vía `npm run opening:approve` |
| `ordering_enabled` | La plataforma, al verificar. El dueño o encargado puede **apagarlo**, y encenderlo sólo si sigue verificado (la base lo exige) | Junto con la verificación | Que siga verificado y activo | La misma RPC. Si hay que revocar: `npm run opening:approve -- --revoke` |

```
npm run opening:approve -- --verifier-email <correo del operador> --note "canary retiro"
```

La herramienta:

- muestra la lista;
- se niega si falta algo, y la base vuelve a controlar todo;
- pide escribir el identificador del comercio (`la-taba-cp`);
- deja auditado quién, cuándo, la nota y los números del catálogo.

**No abre el local.** Para ensayar antes, sin escribir: `npm run opening:dry-run`.

## 10. Abrir

Panel › **Abrir el negocio**:

| Botón | Qué hace | Quién |
| --- | --- | --- |
| Abrir el negocio | Empieza a tomar pedidos dentro del horario | Dueño, encargado o equipo |
| Pausar pedidos | La tienda muestra el local, pero no toma pedidos nuevos | Dueño, encargado o equipo |
| Reanudar pedidos | Vuelve a tomar pedidos | Dueño, encargado o equipo |
| Cerrar el negocio | Pide confirmación y deja de tomar pedidos hasta reabrir | Dueño o encargado |

- La tienda lo ve al instante.
- Si todavía falta algo, la pantalla lo dice y lleva a «Preparar apertura».
- Cada cambio queda auditado.

Antes de abrir para el canary:

- `npm run opening:check -- --min-products 5` con `CAN_OPEN: YES`;
- el Panel abierto en el mostrador con el **timbre** encendido (botón de la cabecera). Así se entera el local de un pedido nuevo;
- la impresora es opcional: Panel › Impresora del local.

## 11. Pedido canary

1. Una persona conocida entra a `https://la-taba-commercial-pilot.pages.dev/` y compra un producto sin alcohol, **retiro** y **efectivo**.
2. En el Panel:
   - el pedido entra con el timbre;
   - «Aceptar» → «En preparación» → «Listo para retirar»;
   - al entregar: «Registrar efectivo recibido» y «Entregado».
3. El cliente ve el estado en su seguimiento. El stock bajó una unidad.
4. `npm run opening:check` y el pulso operativo (`node scripts/controlled-production/ops-pulse.mjs --target controlled-production --business-id e7850ad2-a447-402c-8375-3fd74e9466ba`) siguen sanos.

Después, el plan 5 → 15 → 30 de [`docs/LA-TABA-MORNING-HANDOFF-2026-09-28.md`](LA-TABA-MORNING-HANDOFF-2026-09-28.md).

## 12. Cerrar y volver atrás

- **Frenar ya:** Panel › Abrir el negocio › «Pausar pedidos». Si hace falta más, «Cerrar el negocio».
- **Sacar un producto:** Catálogo › «Ocultar de la tienda».
- **Quitar la habilitación online:**

  ```
  npm run opening:approve -- --revoke --verifier-email <operador> --reason "<motivo>"
  ```

  Queda auditado. Para volver, hay que verificar de nuevo.
- **Web:** Cloudflare Pages → `la-taba-commercial-pilot` → promover el deployment anterior. Probado en cada deploy con el simulacro B→A→B.
- **Base:** las tres migraciones de esta etapa tienen rollback compensatorio probado en CI. Se revierten en orden inverso:
  1. [`20260928170000_identity_and_alcohol_invariants_null_safe`](migrations/rollback/20260928170000_identity_and_alcohol_invariants_null_safe.rollback.sql): devuelve las dos restricciones a su texto anterior. Se niega (ROLLBACK_BLOCKED) si ya se borró una cuenta que había aceptado una invitación.
  2. [`20260928160000_publish_sets_merchant_intent`](migrations/rollback/20260928160000_publish_sets_merchant_intent.rollback.sql): devuelve la planilla al cuerpo anterior. Con ese cuerpo, la primera publicación de un borrador de CP vuelve a fallar.
  3. [`20260928150000_store_opening_readiness`](migrations/rollback/20260928150000_store_opening_readiness.rollback.sql): retira las RPC nuevas.
  - Ninguna toca datos.
  - Nunca se restaura un backup sobre CP sin una decisión humana.
