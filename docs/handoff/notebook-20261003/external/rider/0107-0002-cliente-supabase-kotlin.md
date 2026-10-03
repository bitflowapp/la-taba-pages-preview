# ADR-0002: Cliente Supabase nativo Kotlin como autoridad

- Estado: aceptado para staging, pendiente de spike HTTP.
- Contexto: el service debe refrescar sesión y llamar RPC Gate 2 cuando Flutter no corre.
- Decisión: Kotlin usa HTTPS/OkHttp para Auth y PostgREST RPC con publishable key + Bearer token. Dart no usa `supabase_flutter` en el camino productivo y llama al datasource mediante bridge.
- Alternativas: Supabase sólo en Flutter; clientes duplicados Flutter/Kotlin; supabase-kt como capa única.
- Motivo: una única implementación de refresh, errores, timeouts y headers. El cliente HTTP hace explícito el contrato real y sirve al service.
- Consecuencia: Kotlin debe implementar parseo de Auth/REST, refresh rotado y tests de contrato. No se usa service_role.
- Requisito: validar el spike con staging y una RPC inocua antes de construir toda la app.

