# Conectar la cuenta de Mercado Pago de Walter

Actualización 30/10: producción todavía no está aprovisionada. El estado y las instrucciones vigentes están en [WALTER.md](../mp-closure-20261030/WALTER.md); no hay enlace productivo verificado hoy.

Procedimiento para el día en que Walter acepte la propuesta. **No requiere programar.** Requiere que antes estén
hechos los pasos de [`PRODUCCION.md`](PRODUCCION.md) §2 (proyecto de producción creado, binding mergeado, funciones
desplegadas, secretos cargados **sin** la llave final).

## Antes (Marco, 5 minutos)

1. `node scripts/mercadopago/verificar-configuracion.mjs --ref=produccion` → configuración completa.
2. Confirmar que `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` **no** está cargada: vincular no la necesita, y sin
   ella no se puede cobrar con dinero real aunque la cuenta quede vinculada.
3. Walter debe poder entrar al Panel con su propia sesión de dueño o encargado; soporte no recibe sus credenciales.

## Con Walter (él en su teléfono o PC; 3 minutos)

1. Walter entra a la tienda de La Taba con **su** usuario del Panel → **Configuración → Mercado Pago**.
2. La tarjeta dice «No conectado» y «Dinero real». Lee el aviso: *«Entrá con la cuenta de Mercado Pago del comercio,
   la que va a recibir el dinero. Si en ese navegador ya hay otra cuenta abierta, cerrala antes.»*
   - Si en ese navegador hay abierta una sesión de Mercado Pago de otra persona (por ejemplo la de Marco), cerrarla
     **antes**. Lo más simple: abrir el Panel en una ventana de incógnito.
3. Toca **Conectar Mercado Pago**. Se abre el sitio oficial de Mercado Pago (`auth.mercadopago.com.ar`).
4. Walter escribe **él** su usuario, su contraseña y los códigos que le pida Mercado Pago, y toca **Autorizar**.
   Nadie más tipea ni ve esas claves; La Taba nunca las recibe.
5. Vuelve solo al Panel. La Taba verifica la cuenta con Mercado Pago en ese momento y recién entonces dice:
   *«Listo: Mercado Pago confirmó la cuenta y quedó vinculada.»* y *«La cuenta funciona. El cobro con dinero real
   todavía no está habilitado.»*
6. Walter mira la línea **«Vinculada con …»**: el apodo y el correo enmascarado de la cuenta. Tiene que ser la del
   comercio. Si es la personal, **no vender** y avisar (ver «Si algo sale mal»).

Vincular **no** habilita cobros: la habilitación final es la de [`PRODUCCION.md`](PRODUCCION.md) §4.

## Qué puede salir mal y qué ve Walter

| Lo que pasó | Lo que ve en el Panel | Qué hacer |
|---|---|---|
| Canceló en Mercado Pago | «Cancelaste la autorización… No se vinculó ninguna cuenta.» | Repetir |
| Tardó más de 10 minutos | «El enlace de autorización venció o ya se usó…» | Repetir |
| Su sesión del Panel venció | «Tu sesión del panel venció…» | Volver a entrar y repetir |
| Entró con una cuenta de prueba | «La cuenta… no se puede usar en este entorno…» | Entrar con la cuenta real |
| **Entró con la cuenta de La Taba** (la dueña de la aplicación) | «Entraste a Mercado Pago con la cuenta de La Taba, no con la de tu comercio. No se vinculó nada.» | Cerrar esa sesión de Mercado Pago, entrar con la del comercio, repetir |
| Esa cuenta ya cobra para otro comercio de La Taba | «Esa cuenta de Mercado Pago ya recibe los cobros de otro comercio de La Taba. No se vinculó nada.» | Usar la cuenta de este comercio |
| La tienda ya estaba vinculada con otra cuenta | «Esta tienda ya quedó vinculada con otra cuenta de Mercado Pago y no se cambió nada…» | Soporte (abajo) |
| Mercado Pago no respondió la verificación | «La cuenta quedó registrada, pero la verificación… encontró algo para resolver» + el motivo | «Verificar conexión» en unos minutos |

Ningún mensaje muestra números de vendedor, tokens ni textos técnicos.

## Si quedó vinculada la cuenta equivocada (antes de vender)

La regla de La Taba es que un comercio **no cambia de cuenta receptora** por su cuenta: así ningún cobro se concilia
contra la cuenta de otro. Si la equivocación se nota antes del primer cobro, soporte la corrige así:

1. Walter toca **Desvincular → Sí, desvincular** en el Panel con su propia sesión. Marco no usa las credenciales de Walter.
2. Marco, en el SQL Editor del proyecto de producción (sesión de la organización), ejecuta:

   ```sql
   select public.mp_release_unused_seller_binding(
     '00000000-0000-4000-8000-000000000001',  -- el comercio (deploy/environments.json)
     'production',
     '<número de vendedor vinculado por error>'  -- lo muestra: select seller_id from mp_seller_connections where business_id = …
   );
   ```

   La función se niega si la cuenta sigue vinculada, si el número no coincide o si el comercio tiene **cualquier**
   intento de pago o aviso de Mercado Pago. Deja el cambio auditado (`business_config_audit`, `scope = payments`).
3. Walter vuelve a **Conectar Mercado Pago** con la cuenta correcta.

Si el comercio **ya cobró** con la cuenta equivocada, la función no lo libera: eso exige un plan de migración de
conciliación revisado (no improvisar).

## Después de vincular

- El estado se mira en el Panel («Verificar conexión») y con
  `node scripts/mercadopago/verificar-configuracion.mjs --ref=produccion`.
- La habilitación del cobro y el primer cobro real de control siguen [`PRODUCCION.md`](PRODUCCION.md) §4–§5.
