# Requisitos de credenciales para staging

Resultado: `LIVE_STAGING_TESTS_BLOCKED_BY_MISSING_CREDENTIALS`

La verificacion de presencia no encontro las tres variables requeridas ni un archivo privado con esas asignaciones. No se imprimieron valores, rutas privadas ni identificadores de proyecto.

| Variable | Formato esperado | Uso limitado |
|---|---|---|
| `TABA_STAGING_TEST_FILE` | Ruta local a archivo privado de fixtures/identidades staging | Solo la sesion actual de pruebas sintéticas. |
| `TABA_STAGING_PUBLISHABLE_KEY` | Publishable/anon key de staging | Cliente autenticado de prueba; nunca service role. |
| `TABA_STAGING_SUPABASE_URL` | URL HTTPS del proyecto staging autorizado | Verificar project ref antes de cualquier migracion. |

El archivo, si se entrega, debe estar fuera de Git, ignorado, contener solo datos sintéticos y nunca copiarse a artefactos o logs. La aplicacion de migraciones remotas requiere ademas autorizacion explicita y confirmacion del project ref staging exacto.
