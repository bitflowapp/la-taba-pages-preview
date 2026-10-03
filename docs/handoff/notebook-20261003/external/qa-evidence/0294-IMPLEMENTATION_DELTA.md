# TABA - Delta de implementacion V2.1

## Prototipos actualizados

- `prototype-catalog-mobile.html`: titulo `Resultados`, consulta sin chip, empty state con `Limpiar busqueda`, copy `Seleccion del local`, packshot contenido al 78% sin crop y reserva extra en 320.
- `prototype-business-desktop.html`: accion primaria marcada y unica por breakpoint, sticky detail en 1024-1439, riel visible en 1440+, cascada corregida, codigo sustituido por estado de validacion y eliminacion de senales no disponibles.
- `prototype-rider-android.html`: CTA/slider/secundarias dentro de contrato, entrada de codigo vacia, incidencia `incident_pending` resoluble y cancelacion separada.
- `prototype-checkout-mobile.html`: copia aislada para conservar la superficie aprobada; no se rehace el checkout.

## CSS inmediato de packshots

```css
.p-media img {
  width: 100%;
  height: 78%;
  margin: 11% auto;
  object-fit: contain;
}
```

Esto conserva la etiqueta completa y evita deformacion o recorte. Es una solucion de presentacion; no sustituye la normalizacion futura del pipeline.

## Normalizacion futura del pipeline

1. Detectar el bounding box del objeto sobre el fondo blanco.
2. Recortar margen exterior sin tocar etiqueta, tapa ni base.
3. Normalizar a canvas consistente, con alpha o fondo blanco documentado.
4. Validar que el objeto ocupe 70-82% del alto util y publicar la medicion junto al asset.
5. Rechazar assets que requieran crop destructivo o deformacion.

## Contrato de codigo

El markup operativo no contiene el valor correcto. Negocio y rider trabajan con estados; el backend valida por RPC. El valor de cliente no se replica a negocio, rider, logs ni timeline.
