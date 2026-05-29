# Presentacion para Walter - La Taba online

## Explicacion simple

La Taba online es un canal propio de pedidos para el comercio. El cliente entra a un link, elige productos, arma el carrito y envia el pedido por WhatsApp con todos los datos ordenados.

La idea no es copiar una plataforma grande ni prometer una red nueva de clientes. La idea es que La Taba tenga su propio link para compartir por WhatsApp, Instagram, QR del local o historias, y que los pedidos lleguen mas claros.

## Que problema resuelve

- Evita pedidos incompletos por chat.
- Reduce audios largos y mensajes desordenados.
- Calcula productos, cantidades, envio y total antes de escribir al negocio.
- Permite ofrecer envio a domicilio o retiro en local desde el mismo flujo.
- Le da al comercio una base propia para vender directo.

## Diferencia honesta frente a PedidoYa

PedidoYa puede traer demanda propia, publicidad, pagos, logistica y una app instalada por muchos clientes. Esta demo no reemplaza eso de golpe.

La Taba online apunta a otro problema: atender mejor a los clientes que ya conocen el local y quieren pedir directo. Es un canal propio, con marca del negocio, sin depender completamente de una plataforma externa.

## Como funciona el pedido por WhatsApp

1. El cliente elige productos del catalogo.
2. Revisa el pedido y elige envio o retiro.
3. Carga nombre, telefono, direccion si corresponde, forma de pago y notas.
4. La app arma un mensaje de WhatsApp con pedido, productos, subtotal, envio, total y datos del cliente.
5. El cliente solo tiene que enviar ese mensaje a La Taba.

## Como probar como cliente

1. Abrir la demo: https://bitflowapp.github.io/la-taba-pages-preview/
2. Tocar "Comprar como cliente".
3. Agregar productos al pedido.
4. Entrar en "Mi pedido".
5. Probar envio a domicilio y retiro en local.
6. Completar datos y tocar "Enviar pedido por WhatsApp".
7. Revisar que el mensaje llegue ordenado.

## Como probar administracion del negocio

1. Tocar "Administrar pedidos" o "Ver administracion".
2. Ingresar el PIN demo: `1234`.
3. Revisar ventas de hoy, pedidos para preparar y stock del catalogo.
4. Cambiar estados del pedido.
5. Probar aumentar o bajar stock.
6. Probar pausar o activar productos.

Este acceso es solo de demostracion para la presentacion.

## Como probar repartidor

1. Entrar con PIN demo `1234`.
2. Abrir "Ver repartidor".
3. Revisar el pedido asignado con cliente, direccion, productos y total.
4. Marcar "Sali del local".
5. Marcar "Pedido entregado".

Los pedidos de retiro en local no aparecen en la vista del repartidor.

## Que incluye esta demo

- Web/PWA estatica publicada en GitHub Pages.
- Catalogo con categorias, productos y buscador.
- Carrito con control de cantidades y stock.
- Finalizacion de pedido con envio o retiro.
- Pedido minimo para delivery.
- Mensaje de WhatsApp armado automaticamente.
- Copiar pedido al portapapeles.
- Seguimiento basico del ultimo pedido.
- Administracion demo con PIN `1234`.
- Panel de pedidos, ventas del dia y stock.
- Vista demo para repartidor.
- Tests unitarios y smoke tests de navegador.

## Que queda para una fase real

- Fotos reales y precios finales del comercio.
- Base de datos para pedidos, clientes y stock persistente.
- Login real para negocio y repartidor.
- Panel de administracion con datos reales.
- Pagos online si el negocio lo necesita.
- Notificaciones de pedidos nuevos.
- Mapa/GPS real para reparto.
- App instalable o nativa si el volumen lo justifica.
