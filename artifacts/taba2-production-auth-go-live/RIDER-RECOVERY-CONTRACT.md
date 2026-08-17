# Recuperación de contraseña del Rider · estado y contrato

**Estado: el camino EXISTE y funciona. Falta el cartel que lo señala.**

---

## 1. Lo que se auditó

La aplicación del Rider (`la-taba-rider-android`, rama
`feature/taba2-rider-self-registration`) tiene:

| pantalla | archivo |
|---|---|
| ingreso | `lib/features/auth/presentation/login_page.dart` |
| alta | `lib/features/auth/presentation/sign_up_page.dart` |
| solicitud de acceso | `lib/features/auth/presentation/access_application_page.dart` |
| desbloqueo biométrico | `lib/features/auth/presentation/biometric_unlock_page.dart` |

**No tiene ninguna entrada a «Olvidé mi contraseña».** Un repartidor que olvida
su contraseña queda afuera de la aplicación.

## 2. Por qué igual no está bloqueado

`/auth/v1/recover` es agnóstico del cliente: no le importa si la cuenta se usa
en el Panel o en la aplicación. Y la pantalla `/cuenta/` del sitio, sin
parámetros, ofrece **pedir el enlace**.

O sea que hoy, sin tocar una línea de la aplicación, un repartidor puede:

1. abrir `https://la-taba.pages.dev/cuenta/` en el navegador del teléfono,
2. escribir su correo y pedir el enlace,
3. abrir el enlace del correo —que cae en esa misma pantalla— y elegir su
   contraseña nueva,
4. volver a la aplicación y entrar con la nueva.

**No hace falta deep linking, ni un esquema propio, ni nada nuevo:** el enlace
del correo abre una página web común.

## 3. Lo que falta, y es una sola cosa

Que la aplicación lo **diga**. Un repartidor que no sabe que esa dirección
existe está tan bloqueado como si no existiera.

### El contrato, listo para implementar

| | |
|---|---|
| archivo | `lib/features/auth/presentation/login_page.dart` |
| dónde | al lado del `TextButton` de «Crear cuenta» (línea 72 al momento de esta auditoría) |
| texto | `¿Olvidaste tu contraseña?` |
| acción | abrir `https://la-taba.pages.dev/cuenta/` en el navegador |
| dependencia | **ya está**: `url_launcher: ^6.3.2` en `pubspec.yaml` |
| modo | `LaunchMode.externalApplication` — el enlace del correo tiene que poder abrirse en el mismo navegador |
| la URL | del `runtime-config` productivo, no escrita a mano en el código |

### Por qué no se implementó en esta misión

Es otro repositorio y otra rama, con un worktree que puede estar en uso por otra
sesión, y una edición de Flutter no verificada —sin compilar, sin correr en el
Moto G15— es peor que un contrato preciso. La misión dice explícitamente: si
agregarlo implica improvisar, no improvisar.

**No es una compuerta externa**: no hace falta ninguna cuenta, ninguna compra ni
ninguna decisión de nadie. Es trabajo de código, chico y medible.

## 4. Mientras tanto

En `REGISTRATION-OPERATIONS.md` §4 está escrito el procedimiento para contarle
a un repartidor cómo recuperar su contraseña. Alcanza para el piloto, donde el
comercio conoce a sus repartidores por teléfono.
