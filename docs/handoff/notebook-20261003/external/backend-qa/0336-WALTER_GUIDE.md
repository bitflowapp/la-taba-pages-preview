# Guía breve para Walter — demo privada TABA staging QA

## Antes de mostrar

Usar sólo estas URLs HTTPS temporales:

- Cliente: `https://dresses-happiness-original-leaders.trycloudflare.com/`
- Negocio: `https://dresses-happiness-original-leaders.trycloudflare.com/#business`
- Rider: `https://dresses-happiness-original-leaders.trycloudflare.com/#rider`
- Tracking: `https://dresses-happiness-original-leaders.trycloudflare.com/#tracking`

No agregar `demo=1` y no usar el relay. Las cuentas son sintéticas; las
contraseñas se entregan por separado y no están en esta guía.

## Recorrido QA

1. En Cliente, iniciar sesión anónima, abrir Perfil y guardar nombre/teléfono.
2. Guardar una dirección y crear un pedido con el catálogo QA.
3. En Negocio, iniciar sesión con la cuenta sintética y confirmar que el pedido
   aparece aunque la vista se abra después.
4. Usar el pedido activo `LT-0002`: debe verse `En camino` y con entrega.
5. En Rider, iniciar sesión con la cuenta sintética: debe aparecer `LT-0002`.
6. En el cliente, abrir Tracking en la misma sesión que creó el pedido. El
   enlace genérico no contiene un token; esto es intencional.

`LT-0001` ya fue cerrado en staging y sirve para mostrar la prueba completa:
`received → accepted → preparing → ready → assigned → picked_up → on_the_way
→ arrived → delivered`, incluyendo fallo de código incorrecto y éxito de
código correcto.

## Moto G15

El serial esperado es `ZY32LHS6PS`. Con el teléfono desbloqueado:

1. Abrir Chrome y conceder ubicación precisa “mientras se usa” al navegador y
   al sitio HTTPS.
2. Abrir la URL Rider y autenticar la cuenta rider.
3. Abrir `LT-0002`, iniciar/compartir GPS y comprobar el mapa MapLibre y el
   marcador del rider.
4. Verificar desde Tracking que la ubicación se actualiza.
5. Apagar y encender la pantalla, volver a Chrome y verificar recuperación.
6. Crear acceso directo/PWA sólo si Chrome lo ofrece.

No usar `adb geo fix`, coordenadas inventadas ni simulación como PASS. En esta
ejecución el Moto estaba bloqueado, por lo que la parte física queda pendiente.

## Límite comercial

El catálogo es `demo_fixture`, `test_only`/`staging_only` y tiene derechos
`UNAPPROVED_QA`. No es una aprobación comercial. El catálogo demo autorizado no
contiene agua; no se debe inventar ese SKU ni afirmar que producción está lista.
