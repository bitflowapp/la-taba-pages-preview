# EMPLOYMENT-VALUE — por qué tiene sentido contratar a Marco

Documento de respaldo del video. No es para leerlo en voz alta: es para tenerlo a mano
si Walter pregunta en serio, o para dejárselo si quiere pensarlo.

---

## 1. El argumento, en una línea

> No tiene sentido contratar a Marco porque hizo una página.
> Tiene sentido contratarlo porque puede **construir, operar y seguir automatizando**
> la infraestructura tecnológica del negocio.

Una página se compra una vez. Un sistema por el que pasa la plata del negocio se
**opera**: alguien tiene que atenderlo cuando algo falla, cambiarlo cuando el negocio
cambia y ampliarlo cuando aparece una oportunidad. Eso no es un producto, es un rol.

---

## 2. Qué existe hoy, en términos del negocio

Cada línea de esta tabla se puede ver funcionando en el video.

| Pieza | Qué le resuelve al negocio |
| --- | --- |
| **Tienda** | El cliente compra desde el teléfono, con el catálogo, los precios y el stock del local. Sin llamados, sin anotar a mano, sin errores de transcripción. |
| **Cobro** | El pedido se cobra con Mercado Pago y el sistema espera la confirmación antes de darlo por bueno. Certificado de punta a punta en el entorno de pruebas. |
| **Panel del negocio** | El pedido llega solo, con cliente, dirección, productos y total, y se trabaja en tres pasos. Un solo lugar, no cuatro cuadernos. |
| **App de reparto (Android)** | El repartidor toma el pedido, retira, entrega y cierra con un código. Certificada sobre un teléfono real. |
| **Seguimiento del cliente** | El cliente ve el estado y el mapa. Menos llamadas al mostrador preguntando «¿falta mucho?». |
| **Centro de operación** | Qué pedidos se demoraron, qué pagos hay que revisar, qué está trabado y qué conviene hacer. En castellano, no en códigos. |
| **Métricas y caja** | Ventas del turno, ticket promedio, más vendidos, cierre del día. |
| **Catálogo y stock** | Los cambia el negocio, sin depender de nadie. |
| **Facturación (ARCA)** | Circuito completo construido y probado con datos sintéticos. Falta el certificado para encenderlo. |
| **Pedidos por WhatsApp** | Canal construido y probado en pruebas: mismo catálogo, mismos precios, mismo pedido. Falta conectar el número oficial. |

---

## 3. Lo que distingue este trabajo de «una página»

### 3.1 El sistema dice lo que no sabe

Es la decisión de diseño más importante de todo el proyecto, y es la que más se nota
en la operación diaria:

- Si el repartidor deja de reportar posición, el mapa **dice que no hay ubicación**
  en vez de mostrar el último punto como si fuera el actual.
- Si un pedido no tiene coordenadas autorizadas, la app del repartidor **dice que no
  hay mapa y que use la dirección escrita**, en vez de inventar un punto.
- Si un comprobante es de prueba, el PDF **lo dice impreso encima**, para que nadie lo
  entregue por error.
- Si un pago entró aprobado y no tiene pedido armado, el Panel **frena y avisa** en vez
  de dejarlo pasar.

Un sistema que miente cuando no sabe hace perder plata y clientes en silencio.
Este está construido al revés a propósito.

### 3.2 Lo que falta está escrito

En este proyecto hay documentos que dicen, con nombre y apellido, qué **no** está hecho:
que falta el certificado de ARCA, que el reparto real necesita datos móviles en el
teléfono, que una prueba no se corrió y por qué. Nada de eso se descubre después.

Para un dueño de negocio eso vale más que una lista de funcionalidades: significa que
puede confiar en lo que se le dice, incluso cuando la noticia es mala.

### 3.3 Está probado antes de tocar plata real

La compra completa —con pago y con entrega— se cerró primero contra un entorno de
pruebas, con Mercado Pago en modo TEST y sin dinero real. Recién después se preparó el
primer pedido humano. El orden importa: ese es el orden que evita que el primer cliente
real sea el que descubra el problema.

### 3.4 Toca la operación, no sólo la pantalla

El reparto se certificó **sobre un teléfono real, en la calle**, no sobre un emulador:
la app perdiendo señal y recuperándola, la pantalla apagándose, el pedido volviendo del
segundo plano, el código correcto y el incorrecto en la puerta. Eso no aparece en un
demo bonito; aparece la primera noche de trabajo real.

---

## 4. Qué se contrata, exactamente

No es «que me pague la página». Es un rol con cuatro funciones:

**1 · Soporte de la operación.**
Que el sistema esté disponible cuando el negocio vende. Mirar lo que el Panel marca
como trabado, destrabarlo y avisar.

**2 · Mantenimiento.**
Precios, catálogo, zonas de reparto, horarios, formas de pago. Y lo que se rompa
cuando algo del afuera cambia —y siempre cambia—: la pasarela de pago, el teléfono
del repartidor, el navegador de un cliente.

**3 · Automatizaciones nuevas.**
Cada cosa que hoy alguien hace a mano dos veces por día es candidata. Facturación
automática es la primera de la lista y ya está construida. Después: avisos al cliente,
reposición de stock, cierres, conciliación de cobros.

**4 · Integraciones y proyectos nuevos.**
WhatsApp es el próximo canal. Después, lo que el negocio necesite: otro punto de venta,
otro sistema, otro rubro.

---

## 5. Cómo se mide si valió la pena

Propuesta concreta para el piloto de un mes. Todos estos números salen del propio
sistema; no hay que llevarlos a mano.

| Qué mirar | Dónde sale |
| --- | --- |
| Pedidos entrados por el sistema vs. por teléfono | Panel · Reportes |
| Ticket promedio | Panel · Métricas |
| Pedidos demorados | Centro de operación |
| Llamadas de clientes preguntando por su pedido | lo cuenta el mostrador; debería bajar |
| Errores de dirección o de producto | lo cuenta el reparto; debería bajar |
| Tiempo del dueño dedicado a coordinar pedidos | lo estima Walter al principio y al final |

Si al mes esos números no se movieron, el piloto falló y hay que decirlo. Esa es la
misma regla que se usó para construir todo lo demás.

---

## 6. El riesgo real, dicho de frente

**El riesgo de contratar a una sola persona es que esa persona no esté.**
Se mitiga así, y conviene ponerlo por escrito desde el día uno:

- Todo el sistema está documentado: cómo se despliega, cómo se configura, qué hacer
  cuando algo falla. No vive en la cabeza de nadie.
- Los datos son del negocio y son exportables. No hay secuestro de información.
- Un plazo de aviso acordado, en las dos direcciones.

**El riesgo de no contratar a nadie** es distinto y menos visible: un sistema que
maneja pedidos y cobros sin nadie que lo atienda no se queda quieto, se degrada. Y el
día que falla, falla vendiendo.

---

## 7. Lo que este documento no dice

- No hay una cifra de sueldo ni de honorarios. Eso se cotiza contra un alcance concreto.
- No hay una fecha para ARCA ni para WhatsApp: dependen de trámites que no maneja Marco.
- No se promete que el sistema aumente las ventas. Se promete que **ordena la operación
  y muestra lo que está pasando**. Lo que se haga con eso es del negocio.
