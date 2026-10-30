# Revisión del modelo y los dos rechazos OAuth — 30/10/2026 17:32 UTC

**Conclusión:** el bloqueo observado es una denegación de autorización en Mercado Pago, antes de obtener un grant válido de B. No encontramos en esta TestApp un ajuste básico que permita habilitar Marketplace, ni una corrección local cuya eficacia esté demostrada. La regla exacta de rechazo debe confirmarla el proveedor; no se declara que TestApp sea universalmente incompatible con OAuth ni que el callback antiguo sea necesariamente la causa.

Se recuperó el acceso con A mediante sus credenciales de prueba ya autorizadas, en Chrome aislado. No se usó la cuenta personal `721168650`, no se pidieron credenciales y no se generaron nuevos enlaces ni intentos OAuth. No se cambió configuración externa ni código.

## Qué se verificó adicionalmente en el panel

1. **Modelo visible:** TestApp-ae01fd1d `4861627125869370` continúa figurando como integración para la propia cuenta. Esa etiqueta es la clasificación mostrada por el panel, no una prueba independiente de capacidad o incapacidad de OAuth para terceros.
2. **Datos básicos:** nombre, descripción, logo, rubro comercial y sitio. Se abrió el desplegable de rubros: contiene 16 categorías comerciales, **ninguna Marketplace**. No se seleccionó ninguna ni se guardó el formulario. Cambiar el rubro no constituye una habilitación Marketplace demostrada.
3. **Producto integrado:** Pagos online, sin plataforma e-commerce, Checkout Pro y API de Preferencias. Las opciones visibles permiten elegir producto/API, no convertir explícitamente esta aplicación en un marketplace. No se cambió ninguna selección.
4. **Configuración avanzada:** URLs OAuth, PKCE Sí y permisos read/offline access/write. No se encontró un selector adicional de Marketplace/Authorization Code. El botón Guardar seguía deshabilitado porque no hubo cambios.
5. **API efectiva:** activa, sin bloqueo global ni deshabilitación, PKCE activado, los tres scopes presentes; callback QA exacto incluido en `callback_urls`; principal todavía del backend retirado; `allow_flow:[]`. Ninguno de esos datos prueba por sí solo qué política de seguridad aplica al par TestApp/B.

La documentación oficial de [configuración Marketplace](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/create-configuration) describe la selección del modelo al crear una aplicación. No documenta en esa página una conversión de esta TestApp automática ya existente. No se abrió ni creó otra aplicación para sustituirla.

## Cómo interpretar los mensajes sin inventar una causa

| Mensaje aportado por el usuario | Qué demuestra | Qué no demuestra |
|---|---|---|
| «La aplicación no está preparada para conectarse a Mercado Pago» | El flujo del proveedor no permitió avanzar con esa solicitud. | No identifica por sí mismo callback, modelo, PKCE, KYC o scope concretos. |
| «La aplicación no puede conectarse a tu cuenta. Esta aplicación solicita acceso a información que, por seguridad, no podemos compartir» | La interfaz de Mercado Pago comunica una denegación de acceso por seguridad para esa aplicación/cuenta. | No publica el scope/recurso ni la regla interna que la dispara. No prueba que baste quitar `write`, que haya un defecto de La Taba o que toda cuenta de prueba tenga esa restricción. |

Los mensajes se conservan como **reportes del usuario**, no como respuestas instrumentadas con un correlation ID del intento. Tampoco tenemos identidad efectiva autenticada y trazabilidad del proveedor para cada uno de esos dos fallos. La cuenta personal `721168650`, A y B son identidades distintas: la incapacidad del navegador personal para administrar TestApp es esperable por titularidad y no se toma como explicación del rechazo OAuth de B.

El proveedor documenta [requisitos para Marketplace](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/prerequisites), incluidos identificación y uso de OAuth, y [restricciones administrativas de perfiles de prueba](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/additional-content/your-integrations/test/accounts). Esas reglas no permiten concluir que una de ellas produjo estos mensajes específicos. No se pide al vendedor de prueba completar una verificación real a partir de una hipótesis.

## Corrección posible e impacto

- **No hay un cambio verificado para aplicar ahora.** No se propone elegir Otro rubro, cambiar de API, quitar scopes, desactivar PKCE, cambiar de cuenta integradora ni crear otra app por tanteo.
- El callback principal antiguo es una inconsistencia que podría corregirse de manera reversible preservando las dos URLs, pero la URL QA ya está registrada. Sin confirmar qué campo valida este flujo no se presenta ese cambio como solución y no se aplica.
- La habilitación de terceros, compatibilidad entre perfiles/cuentas de prueba y la política que dispara la denegación deben confirmarse para los IDs concretos con Mercado Pago. Si indican un ajuste soportado, se documentará el valor exacto, alcance, efecto sobre grants y reversión **antes** de pedir/aplicar su aprobación.

La [consulta de soporte actualizada](CONSULTA-SOPORTE.md) pide esa respuesta concreta e incluye evidencia saneada. Queda preparada, no enviada. No se requieren claves para formularla.

## Estado y evidencia

Lectura de B a las 17:32:35 UTC: `disconnected`, entorno `test`, sin seller/app guardados, scopes vacíos y sin vencimiento. No hay grant válido que permita declarar GO de vinculación o certificar R-MKT-1.

[Evidencia nueva](evidencia/revision-modelo-y-segundo-error.json): 16 opciones de rubro, selecciones actuales, ausencia de selector Marketplace, configuración efectiva y estado B. El request ID de configuración es una lectura de API, no el ID del rechazo OAuth. El manifiesto de hashes se actualizó. No hubo pagos, despliegues, cambios de credenciales ni producción.
