# DEMO WALTER — TABA2 staging

Preparado 2026-08-13. Todo apunta a **staging** (`ukxqbgswjlibmnjemrzd`). No hay producción.

---

## CLIENTE

<https://taba2-staging.pages.dev>

Andá con Chrome o Safari. No hace falta instalar nada.

## NEGOCIO

<https://taba2-staging.pages.dev/#business>

Entrá con la cuenta staff de abajo. El panel pide sesión propia: es la compuerta nueva.

## RIDER

APK: `D:\1212\artifacts\taba2-demo-walter\TABA2-Rider-Demo-Staging.apk`

* sha256 `68a25ab7841060c87fc16b93043879c451eb66cea85ef33628d934c457afc03e`
* 191.236.474 bytes (182,4 MB)
* paquete `com.lataba.rider.staging` (convive con el de producción, no lo pisa)
* sale del Rider `894267a`

**En esta versión el repartidor no activa turnos ni toma pedidos.** El pedido le
llega **sólo** porque el Panel se lo asigna. Sin pedido, la app dice
**«Esperando pedidos»** y no hay que tocar nada.

## DISPOSITIVO

Moto G15 `ZY32LHS6PS`.

⚠️ **Antes de la demo: reconectá el cable USB y verificá que la app abra.** El
teléfono se desconectó al final de la preparación, así que el circuito físico
completo quedó sin correr (ver *Qué falta verificar*).

## CUENTAS

Sólo identificadores. **Las claves están en `C:\1212\secrets\`, no acá.**

| Rol | Identificador | Archivo |
|---|---|---|
| Staff (panel) | `demo-walter-staff-38cfb5c4@staging.local` | `taba2-demo-walter-staff-login.txt` |
| Rider (Moto) | `demo-walter-rider-20a1f247@staging.local` | `taba2-demo-walter-rider-login.txt` |

---

## DEMO 5 MINUTOS

**Antes de empezar:** abrí la app del Moto. Tiene que decir **«Esperando
pedidos»**. Si dice eso, está lista: no toques nada más.

1. Walter abre el **Cliente**.
2. Agrega un producto al carrito.
3. Checkout. **Anotá el código de 4 dígitos que le queda al cliente** — sin eso el
   repartidor no puede cerrar la entrega.
4. El pedido aparece en **Negocio → Pedidos**.
5. Aceptar → preparar → listo → **asignar el rider** (el de la tabla de arriba).
6. Mostrar el **Moto**: el pedido entra solo, sin tocar la pantalla, con dirección,
   plata y mapa.
7. «Iniciá el recorrido» → el estado pasa a *en camino* y el GPS empieza a publicar.
8. Mostrar el **seguimiento en el Cliente**: el punto del repartidor se mueve.
9. En el Moto: «Llegué» → **ingresar el código del paso 3** → entregado.
10. Ver el estado final y que el punto del repartidor desaparece del seguimiento.

---

## FALLBACK

**Si el pedido tarda en aparecer en el Moto:** esperá hasta un minuto. La app
consulta al servidor cada 15 s; no hay que reiniciar ni volver a entrar.

**Si el GPS físico no engancha** (adentro, sin señal): no inventes recorrido.
Mostrá que la app dice honestamente «Sin GPS» / «Señal débil» en lugar de dibujar
una posición falsa — es una decisión de diseño, no una falla. El circuito completo
ya está certificado servidor-adentro: pedido **LT-0148**, 47/47, con GPS válido,
throttle, seguimiento y purga al entregar.

**Mercado Pago hospedado:** no lo uses en vivo. Cobrá en **efectivo** (o el método
QA que ya esté configurado): cierra el circuito igual y no depende de la página de MP.

**Nunca** muestres un pago aprobado con una captura: si MP no responde, se dice que
quedó pendiente.

---

## QUÉ FALTA VERIFICAR

El circuito físico de punta a punta en el Moto **no se pudo correr**: el teléfono
se desconectó del USB en medio del gate. Lo que sí quedó probado en el aparato:
el APK instala, arranca sin crash y muestra «Esperando pedidos», sin rastro de
«Trabajar ahora».

Falta, y conviene ensayarlo una vez antes de que llegue Walter:

`Panel asigna → el pedido aparece solo → retirado → en camino → GPS → llegué → PIN → entregado`

---

## DETALLE MENOR

El cartel de huella («Protegé tu sesión») tiene el botón «Ahora no» pegado a la
barra de Android; si no responde, tocá un poco más arriba.

---

## SHA

* App/DB: `bc9af92` — rama `release/taba2-commercial-rc` (sin push)
* Rider: `894267a` — rama `feature/taba2-rider-pilot-integration` (sin push)
* Base de datos staging: 96/96 migraciones, 0 pendientes, 0 drift
