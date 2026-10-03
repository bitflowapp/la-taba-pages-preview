# Checklist de credenciales ARCA

Estado actual: `ARCA_HOMOLOGATION_READY_FOR_CREDENTIALS`.

- [ ] Certificado de homologación obtenido por WSASS.
- [ ] Clave privada montada fuera del repositorio.
- [ ] CUIT confirmado por el responsable.
- [ ] Certificado y clave coinciden.
- [ ] Certificado vigente y cadena validada.
- [ ] Punto de venta de homologación configurado.
- [ ] `ARCA_ENVIRONMENT=homologation`.
- [ ] `ARCA_HOMOLOGATION_CONSENT=I_AUTHORIZE_ARCA_HOMOLOGATION` escrito por el usuario sólo cuando autorice las llamadas.
- [ ] `SUPABASE_SERVICE_ROLE_PATH` apunta a un secreto montado fuera del repositorio.

El worker rechaza rutas relativas, PEM embebidos, CUIT inválido y certificados que no correspondan a la clave. No se guardan valores en Git, PostgreSQL, navegador ni evidencia.
