# Pasos manuales WSASS

Intervención humana obligatoria; no automatizar Clave Fiscal.

1. Abrir la ruta oficial de ARCA para WSASS.
2. Detenerse antes del login y pedir al usuario que inicie sesión.
3. El usuario carga el CSR generado fuera del repositorio.
4. Descargar el certificado de homologación fuera del repositorio.
5. Confirmar que el CUIT representado es el del emisor autorizado.
6. Relacionar el certificado con WSAA y WSFEv1 para homologación.
7. Configurar el punto de venta de homologación cuando corresponda.
8. Montar los archivos en el worker privado y ejecutar sólo validaciones locales.

No solicitar al usuario CUIT, contraseña, MFA ni capturas sensibles. No usar scraping ni evadir controles.
