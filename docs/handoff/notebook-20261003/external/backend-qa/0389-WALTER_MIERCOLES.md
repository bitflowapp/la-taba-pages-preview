# WALTER — MIÉRCOLES

## ANTES DE SALIR

- **Notebook**: cargada al 100% y con cargador en mano.
- **Conectividad**: celular con datos móviles para compartir tethering si falla Wi-Fi.
- **URL**: https://taba2-staging.pages.dev/#business
- **Release**: la-taba-runtime-v97-explicit-seller-status (Staging limpio).
- **Estado esperado**: Tarjeta Mercado Pago en estado **No conectado** con botón «Conectar Mercado Pago».
- **Usuario TABA**: demo-walter-staff-38cfb5c4@staging.local (contraseña en secrets/taba2-demo-walter-staff-login.txt).
- **Verificación rápida**: Abrir ventana de incógnito en la notebook, entrar a la URL, loguearse y confirmar que se ve **TABA Walter Staging**, rol **Dueño**, solapa **Pagos** visible.

---

## CON WALTER

1. Abrir la notebook con https://taba2-staging.pages.dev/#business.
2. Marco inicia sesión con el usuario dueño de TABA.
3. Ir a la solapa **Pagos**.
4. Mostrar a Walter la tarjeta **Mercado Pago** en estado **No conectado**.
5. Tocar **«Conectar Mercado Pago»** una sola vez y girar la notebook hacia Walter.

---

## WALTER HACE

1. En la pantalla de Mercado Pago (o Mercado Libre), ingresar sus credenciales reales de Mercado Pago.
2. Resolver en privado su segundo factor de autenticación (SMS, WhatsApp o App de MP).
3. Verificar que la aplicación que solicita permisos sea **TABA2 Staging**.
4. Aceptar y autorizar los permisos (read, write, offline_access).
5. Esperar el retorno automático a la pantalla de TABA.

---

## MARCO HACE

1. Iniciar la sesión de TABA antes de ceder el control a Walter.
2. Asegurarse de que Walter use su cuenta cobradora real (no una cuenta personal secundaria ni la cuenta de Marco).
3. Monitorear el regreso automático al panel.
4. Tocar **«Verificar conexión»** una vez finalizado el callback.
5. NO tocar «Desconectar» ni hacer pagos reales de prueba en esta sesión.

---

## RESULTADO CORRECTO

- Retorno automático a https://taba2-staging.pages.dev/?mp_connection=connected#business.
- La tarjeta muestra: **✓ Mercado Pago conectado correctamente**.
- Se muestra el identificador de cuenta (seller_id) de Walter.
- Aparecen los botones **«Verificar conexión»** y **«Desconectar»**.
- Al recargar la página (F5), el estado permanece **Conectado**.

---

## SI FALLA

### OAuth no abre
- **Diagnóstico**: Error de red o bloqueo de pop-up/redirección en el navegador.
- **Solución**: Permitir redirecciones, chequear tethering, o tocar «Conectar Mercado Pago» una vez más.

### Callback falla
- **Diagnóstico**: Mercado Pago no pudo alcanzar el endpoint HTTPS de Supabase o el parámetro state expiró (>10 min).
- **Solución**: Volver a https://taba2-staging.pages.dev/#business, entrar a Pagos y reintentar la conexión desde cero (genera un nuevo state de 10 minutos).

### Seller no persiste
- **Diagnóstico**: El intercambio del authorization code falló server-side (rechazo de Mercado Pago o live_mode incompatible).
- **Solución**: Verificar que Walter autorizó con una cuenta válida en Argentina. El panel mostrará: «Necesitamos volver a conectar Mercado Pago». Tocar «Reconectar».

### Panel sigue No conectado
- **Diagnóstico**: El navegador mantuvo en caché la vista anterior o el service worker no refrescó el estado.
- **Solución**: Tocar el botón «Actualizar» dentro de la solapa Pagos o hacer un Hard Refresh (Ctrl + Shift + R).

### Webhook falla
- **Diagnóstico**: El webhook de Mercado Pago no impactó en Supabase (no afecta la autorización OAuth en esta etapa).
- **Solución**: La conexión de Walter queda persistida en mp_seller_connections independientemente del primer evento de webhook.

---

## ROLLBACK

Si se necesita salir de la sesión sin romper plataforma ni datos:
1. En la solapa **Pagos**, pulsar **«Desconectar»** y confirmar.
2. Esto revoca los tokens locales, pausa los cobros y conserva el historial intacto.
3. Cerrar la sesión del panel. Staging queda en estado inicial limpio.
