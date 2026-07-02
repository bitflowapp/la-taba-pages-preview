# La Taba Pizzería · presentación comercial honesta

Esta PWA estática muestra el catálogo y el recorrido comercial de PedidoPropio para La Taba Pizzería. No tiene backend ni integraciones productivas: no recibe pedidos reales, no procesa pagos, no conecta repartidores y no usa GPS o ubicación en vivo.

## Los dos modos

### Modo público

Abrí la URL normal:

```text
https://bitflowapp.github.io/la-taba-pages-preview/
```

El cliente puede explorar el catálogo, armar un pedido y completar el checkout. La acción final prepara un **Pedido de demostración** y aclara que no fue enviado al comercio ni generó una compra real.

En este modo:

- no aparecen Negocio, Rider ni el PIN;
- no hay pedidos, ventas, métricas ni personas ficticias;
- no se ofrece WhatsApp porque todavía no hay un número verificado;
- el pago queda como **Pago a coordinar con el local**;
- dirección, horarios, cobertura y condiciones no verificadas se muestran como pendientes de confirmación.

### Modo Walter / presentación

Agregá `?demo=1` a la misma URL:

```text
https://bitflowapp.github.io/la-taba-pages-preview/?demo=1
```

Una franja persistente indica que los pedidos y estados se simulan en el dispositivo. Este modo habilita Cliente, Negocio y Rider para recorrer el flujo completo en un solo teléfono.

Código de presentación: `1234`.

Recorrido sugerido:

1. Como Cliente, agregá un producto, completá datos válidos y confirmá el pedido simulado.
2. Entrá a Negocio con el código de presentación y avanzá el pedido hasta **Listo**.
3. Abrí la Vista rider y confirmá salida, llegada, código de entrega y entrega final.
4. Volvé a Cliente para mostrar el estado entregado.

No se simulan GPS, ETA, mapas ni conexión entre dispositivos. Todos los datos comerciales y las métricas del panel se rotulan como **Simulación** o **Datos de ejemplo**.

Para iniciar una presentación limpia:

```text
https://bitflowapp.github.io/la-taba-pages-preview/?reset=1&demo=1
```

`reset=1` limpia la sesión local una vez y luego desaparece de la URL. La versión de persistencia también invalida automáticamente estados incompatibles de versiones anteriores, incluida la antigua experiencia de carnicería.

## Desarrollo local

Requisitos: Node.js y Python disponibles en el equipo.

```bash
npm install
python -m http.server 8080
```

Abrí:

```text
Público: http://127.0.0.1:8080/
Walter:  http://127.0.0.1:8080/?demo=1
```

## Verificación

```bash
npm run check
npm test
npm run test:e2e
```

La suite cubre, entre otros casos:

- invalidación de persistencia vieja;
- separación entre público y demo;
- ocultamiento de roles y PIN;
- confirmación pública que declara que no fue enviada;
- validación de teléfono, dirección y zona;
- cupón público desactivado;
- pago coordinado sin integración;
- datos iniciales limpios en público;
- demo local sin GPS, ETA ni ubicación en vivo;
- viewport Moto g15 de 432 × 815 sin overflow horizontal.

## Configuración pendiente antes de producción

Los datos reales deben confirmarse con el comercio en `js/config.js`. WhatsApp solo se habilita cuando hay un número real y `whatsappVerified` es `true`; las condiciones operativas solo deben habilitarse cuando fueron verificadas.

Esta rama no agrega backend, Firebase, pagos, GPS ni servicios externos. Convertir el recorrido en operación real requiere una fase separada con alcance, seguridad, privacidad y datos comerciales aprobados.
