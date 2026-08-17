# Cómo se da de alta a la gente en TABA

Esto es para quien atiende el comercio, no para quien programa.

---

## La regla que ordena todo

**Crear una cuenta no da acceso a nada.** Cualquiera puede crearse una cuenta;
eso sólo crea una identidad. Para entrar al Panel o para repartir hace falta que
**alguien del comercio diga que sí**. Siempre. No hay excepción, ni siquiera
para el dueño (el primer dueño se da de alta una sola vez, aparte, y está
explicado al final).

---

## 1. Alguien quiere trabajar en el Panel

**Lo que hace esa persona:**

1. Entra a la dirección del comercio y va a la pantalla del Panel.
2. Toca **«Creá tu cuenta»**, pone su correo y una contraseña.
   La contraseña necesita **12 caracteres o más** y no puede ser una que ya
   haya aparecido en filtraciones conocidas (el sistema lo revisa solo y lo
   dice si pasa).
3. Recibe un correo y lo confirma. *(Hoy este paso no funciona: falta el
   servicio de correo. Ver `SMTP-PRODUCTION-STATUS.md`.)*
4. Vuelve a entrar y completa **«Pedí acceso al comercio»**: nombre y apellido,
   y teléfono.
5. Ve una pantalla que dice **«Solicitud enviada»**. Ahí se queda.

**Lo que ves vos:**

1. Entrás al Panel con tu cuenta de dueño o encargado.
2. En la bandeja de solicitudes aparece esa persona: nombre, teléfono, cuándo
   pidió y para qué (Panel o reparto).
3. Decidís:
   * **Aprobar**, y elegís qué es: *empleado* o *administrador*.
   * **Rechazar**, y podés escribir un motivo.
4. Listo. Si la aprobaste, esa persona entra la próxima vez que abra el Panel,
   con lo que le corresponde a su rol y nada más.

**Lo que no puede pasar, y está probado contra la base real:**

* Nadie se aprueba a sí mismo. Ni un dueño con su propia solicitud.
* Nadie elige su propio rol: el rol lo elegís vos al aprobar. Si alguien pide
  ser dueño, igual entra con lo que vos decidiste.
* Mientras está esperando, esa persona **no ve ningún pedido, ningún cliente y
  ningún dato del comercio**. Su cuenta existe y no tiene nada adentro.
* Alguien ya aprobado como empleado no puede subirse solo a administrador.

## 2. Alguien quiere repartir

Es el mismo camino, con una diferencia: en el paso 4 elige **reparto** en vez
de Panel, y el teléfono es obligatorio (es por donde lo vas a llamar).

Cuando lo aprobás como **repartidor**, recién ahí su aplicación empieza a ver
pedidos para tomar. Antes: nada. Cero ofertas, cero direcciones, cero teléfonos
de clientes. Probado.

## 3. Alguien fue rechazado

Ve una pantalla que le dice que su solicitud no fue aprobada, y —si corresponde—
desde cuándo puede volver a pedirlo. No ve tu motivo salvo que se lo cuentes vos.

Un rechazo **no borra la cuenta**: la persona sigue teniendo su identidad, sin
acceso a nada. Si más adelante querés que entre, que vuelva a pedirlo.

## 4. Alguien se olvidó la contraseña

1. En la pantalla de ingreso del Panel toca **«Olvidé mi contraseña»**.
2. Escribe su correo. La pantalla contesta **siempre lo mismo**, exista o no la
   cuenta: eso es a propósito, para que nadie pueda usar ese formulario para
   averiguar quién tiene cuenta en el comercio.
3. Le llega un correo con un enlace. El enlace **sirve una sola vez y vence en
   una hora**.
4. El enlace abre una pantalla donde elige la contraseña nueva.
5. La anterior deja de servir en ese mismo momento.

Un repartidor hace exactamente lo mismo desde el navegador del teléfono: el
enlace del correo abre esa pantalla, elige la contraseña nueva, y vuelve a la
aplicación a entrar con ella. **No hace falta ninguna instalación ni ningún
paso especial para el Rider.**

*(Como el paso 3 depende del correo, hoy no funciona: falta el servicio de
correo.)*

## 5. Alguien se va del comercio

Se le quita la membresía desde el Panel. La cuenta sigue existiendo —es de esa
persona, no del comercio— pero deja de ver nada del negocio, y sus sesiones
abiertas se cierran.

Si además quiere **borrar su cuenta**, puede: la base lo permite y no deja nada
colgado. Los pedidos que atendió no se borran ni cambian: la historia del
comercio no se reescribe porque alguien se dé de baja.

## 6. El primer dueño

Es la única alta que no pasa por este camino, porque cuando el comercio nace no
hay nadie que pueda aprobar nada. Se hace **una sola vez**, con una herramienta
que corre desde la computadora del desarrollo, no desde el Panel.

Hace falta un dato que sólo puede dar una persona: **quién es el dueño**
—nombre y correo—. Está explicado en `FIRST-OWNER-BOOTSTRAP-STATUS.md`.

De ahí en adelante, todas las altas salen del Panel.

## 7. Qué queda registrado

Cada decisión —solicitud, aprobación, rechazo, baja— queda escrita en el
registro de identidad del comercio, con quién la tomó y cuándo. Ese registro
**no se puede editar ni borrar**: se agrega, nada más. Si mañana hay que
explicar por qué alguien tenía acceso, la respuesta está ahí.
