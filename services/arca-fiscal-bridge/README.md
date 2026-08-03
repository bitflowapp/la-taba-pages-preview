# `@taba/arca-fiscal-bridge`

Worker privado Node.js/TypeScript para la outbox fiscal de TABA. No es un endpoint para el panel y no debe desplegarse en una red pública.

```powershell
npm ci
npm test
npm run build
npm run credentials:check
npm start
```

Copiar únicamente los nombres de `.env.example` al secret manager del entorno. Los tres secretos se entregan como rutas absolutas montadas: certificado, clave privada y service role. El ambiente predeterminado es `disabled`; homologación y producción requieren gates independientes. El proceso escucha health/readiness sólo en `127.0.0.1`.

La documentación de arquitectura, fuentes oficiales, homologación, despliegue futuro, recuperación y checklist contable está en [`docs/arca/README.md`](../../docs/arca/README.md). No agregar certificados, respuestas SOAP crudas, tokens ni `.env` al repositorio.
