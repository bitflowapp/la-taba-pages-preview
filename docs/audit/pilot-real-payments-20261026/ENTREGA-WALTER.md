# Entrega comercial a Walter: lo que hace él y lo que no

Para el titular del comercio. Nada acá requiere programar ni compartir claves. **Ingeniería no entra a tu cuenta de Mercado Pago, no te pide tu contraseña ni tus tokens (ni por chat, ni por correo, ni por teléfono) y no conecta nada sin que vos lo autorices en tu dispositivo.**

## 1. Autorizar el uso de tu cuenta

Antes de conectar nada, vos decidís (y ponés por escrito, en el documento de autorización del piloto) cuatro cosas: **cuánto**, **qué se compra**, **quién compra** y **cómo se devuelve**. Ingeniería no elige ninguna. Sin tu autorización firmada, el sistema no deja pasar ningún pago real: el comercio nace en modo «piloto cerrado».

## 2. Vincular tu Mercado Pago (3 minutos, en tu teléfono o computadora)

Paso a paso con las pantallas y los errores posibles: [`CONECTAR-WALTER.md`](../mp-commercial-onboarding-20261024/CONECTAR-WALTER.md). En resumen: Panel → **Configuración → Mercado Pago → Conectar Mercado Pago**; el sitio oficial de Mercado Pago te pide **tu** usuario y **tu** contraseña (los escribís vos; La Taba no los ve) y tocás **Autorizar**.

## 3. Confirmar que es tu cuenta

Al volver, el Panel dice *«Mercado Pago confirmó la cuenta»* y muestra **«Vinculada con …»** (apodo y correo enmascarado). **Tiene que ser la cuenta del comercio**, la que va a recibir el dinero. Si es otra (por ejemplo la personal): **no vendas**; avisá a soporte. Vincular no habilita cobros.

## 4. Comprobar que cobrás vos

El día de la compra de control, en la app de Mercado Pago, con tu sesión:

- aparece la operación con el número que te dicta el operador, por el **importe exacto** que autorizaste, «Aprobado»;
- ves la fecha en que el dinero se libera (las cuentas nuevas empiezan con 10, 18 o 35 días);
- quien aparece como compradora es la cuenta compradora que figura en tu autorización, no la tuya.

Si algo no coincide, avisá antes de que se haga cualquier otra operación.

## 5. Ver tus pedidos y pagos

Panel → **Pedidos** (estado de cada pedido) y **Pagos** (cobros, devoluciones y casos para revisar). Los casos que piden una decisión tuya aparecen como avisos en el centro de operación.

## 6. Resolver una devolución

Panel → **Pagos** → el pago → **Devolver el dinero** → importe vacío (todo) o el importe → motivo → escribir `DEVOLVER`. Después **cancelá el pedido con motivo** (el stock vuelve si no se entregó). Si La Taba responde que Mercado Pago rechazó la devolución, **no insistas**: devolvé desde tu cuenta (Actividad → el cobro → «Devolver dinero») y La Taba lo concilia sola, una vez. Detalle: [`PROCEDIMIENTO-DEVOLUCION.md`](PROCEDIMIENTO-DEVOLUCION.md).

## 7. Apagar los cobros si algo no te cierra

Tenés tres botones, de menos a más drástico, todos en Panel → **Configuración → Mercado Pago** (los ve el dueño o el encargado):

| Botón | Qué hace | Para qué |
|---|---|---|
| **Pausar cobros online** | La tienda deja de ofrecer Mercado Pago en el acto; se cobra en efectivo; tu cuenta sigue vinculada | cualquier duda; se reanuda sin volver a conectar |
| **Desvincular** | La Taba borra la credencial que tenía de tu cuenta | quererte ir o sospechar de la conexión (el sistema lo demora hasta 24 horas después de que venza una compra pendiente, para no perder un pago tardío: en ese caso usá «Pausar» y avisá) |
| Quitar el permiso desde tu cuenta de Mercado Pago | La Taba pierde el acceso al instante | si perdés el control del teléfono o de la cuenta |

Además, soporte puede apagar el cobro de tu comercio, retirar la llave final de toda la plataforma o volver a la versión anterior (siete niveles, [`LANZAMIENTO.md`](../commercial-readiness-20261023/LANZAMIENTO.md) §8). **Apagá primero y preguntá después** si: el dinero fue a una cuenta que no es la tuya, hay dos cobros o dos devoluciones por lo mismo, un cobro sin pedido, o creés que se expuso una clave.

## 8. Lo que nunca tenés que hacer

- Pasarle tu contraseña, códigos de verificación o un «token» a nadie, ni a soporte ni a ingeniería.
- Vincular la cuenta desde una computadora donde haya otra sesión de Mercado Pago abierta (usá una ventana de incógnito).
- Repetir una compra o una devolución «por las dudas»: si no estás seguro de qué pasó, esperá y mirá el estado.
- Abrir la tienda al público antes de que el piloto esté verificado y vos lo firmes aparte.

## 9. Quién hace qué

| Tarea | Walter | Operador (ingeniería) |
|---|---|---|
| Elegir importe, producto, comprador, devolución | ✔ | — |
| Vincular su cuenta por OAuth | ✔ (en su dispositivo) | — |
| Cargar secretos, desplegar, correr el preflight | — | ✔ |
| Pagar la compra de control | quien compra (cuenta distinta de la tuya) | — |
| Confirmar que recibió el dinero | ✔ | verifica el registro |
| Ejecutar o aprobar la devolución | ✔ | verifica |
| Apagar los cobros | ✔ (Pausar) | ✔ (niveles 1 a 7) |
| Abrir al público | ✔ firma aparte | ejecuta sólo con esa firma |
