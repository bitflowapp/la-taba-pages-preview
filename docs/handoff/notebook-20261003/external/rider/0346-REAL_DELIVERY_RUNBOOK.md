# RUNBOOK — TABA real mobile pilot (staging)

Objetivo: certificar flujo cliente-rider con staging remoto desde dispositivos móviles.

## Teléfonos
- Cliente:
- Negocio:
- Rider:

## Estado operativo de pedidos (orden esperado)
1. Consulta de catálogo
2. Perfil y dirección creados
3. Pedido creado
4. Negocio recibe pedido
5. Rider toma pedido
6. Rider cambia a on_the_way
7. Cliente ve rider en mapa
8. Rider llega y usa código
9. Rider cambia a delivered
10. Tracking expira/revoca

## Evidencia por corrida
- Timestamps de cambios (UTC-local)
- Conectividad (Wi-Fi on/off)
- Capturas por etapa
- Logs de app / consola
- Resultado de Realtime y GPS

## Recuperación y rollback
- Revocar token
- Cancelar pedido QA
- Deshabilitar preview de Pages
- Retirar cuentas QA
- Revertir deploy de staging

### Restricciones de seguridad
- No exponer service_role, sb_secret_, ANON de producción
- No abrir Supabase local o puertos de la PC
- No modificar producción ni repositorio principal
