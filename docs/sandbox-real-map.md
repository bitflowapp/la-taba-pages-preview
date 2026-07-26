# Mapa geográfico de TABA Sandbox

El mapa real sólo se monta cuando la aplicación está en `?demo=1` y el
repositorio activo es `SandboxOrderRepository`. Producción conserva su camino
fail-closed y no puede consumir estas coordenadas.

## Escenario

Las ubicaciones y los puntos de recorrido están en
`js/sandbox/sandbox_map_scenario.js`. Son coordenadas ficticias dentro de
Neuquén Capital: no representan el domicilio real del comercio ni domicilios
de clientes.

Leaflet carga tiles HTTPS de CARTO/OpenStreetMap y conserva la atribución legal.
Si CARTO falla, el mapa intenta el fallback de OpenStreetMap sin claves
privadas.

## Fuentes de ubicación

- `local_gps`: el rider concede permiso y `watchPosition` publica latitud,
  longitud, precisión y timestamp en la sesión sandbox. El mapa muestra sólo
  comercio, destino y posición actual; no dibuja la ruta estimada ni inventa
  ETA.
- `sandbox_route`: el rider inicia el recorrido de muestra. La polilínea usa
  puntos geográficos del escenario, persiste el progreso y calcula el ETA
  únicamente dentro de la sandbox.

El watcher se detiene al desactivar seguimiento, entregar, ocultar la página o
salir de la vista rider. IndexedDB guarda el estado; BroadcastChannel y el
evento `storage` sincronizan las pestañas del mismo navegador.

La sandbox no sincroniza dos dispositivos distintos. Para probar desde un
iPhone, abrir la URL HTTPS publicada en ese mismo dispositivo y usar el
recorrido de muestra si no se concede ubicación.
