# LOCATION-TRUTH-MANIFEST

**La Taba 2 tiene una sola ubicación, y esta es.**

| | |
| --- | --- |
| **Comercio** | La Taba 2 |
| **Dirección** | Mendoza 827, Neuquén Capital |
| **Coordenada** | `-38.9460616, -68.0533209` |
| **Origen** | `public_directory_cross_checked` |
| **Confianza** | `high` · precisión declarada **20 m** |
| **`human_verified`** | **false** |
| **Fijado** | 2026-08-08T17:16:00Z |
| **Contrato** | `data/business-location.json` |

---

## Lo que este documento NO afirma

**Nadie del comercio confirmó todavía este pin contra la puerta.** El origen es una
ficha comercial pública contrastada contra varias fuentes independientes, que es una
cosa distinta —y más débil— que una verificación humana.

Por eso `human_verified` es `false`, `source` no es `business_verified`, y la precisión
declarada es de **20 metros**: alcanza para poner el pin en la cuadra correcta, sobre
la vereda correcta. No alcanza para afirmar cuál es la puerta.

La base impone esa distinción con un CHECK
(`20260807170000_pickup_point_provenance.sql`): `human_verified` sólo puede ser
verdadero si `source` es `business_verified`. El contrato lo repite, la prueba
`business-location-contract.test.mjs` lo repite y `check-location-contract.mjs` lo
vuelve a comprobar. Subir la afirmación sin subir el origen falla en cuatro lugares.

---

## De dónde sale el punto

**Fuente principal.** La ficha comercial de Google Maps de «La Taba 2»: nombre,
dirección «Mendoza 827, Q8300 Neuquén», categoría Almacén, 4,6 estrellas,
Plus Code `3W3W+HM`, CID `0x960a33d98e978059:0x16953b61ac68be7`.

**Contrastes independientes, y a cuánto quedó cada uno:**

| Contraste | Distancia | Qué dice |
| --- | --- | --- |
| Geocodificación de la dirección sola en Google | **7 m** | coincide sin usar el nombre del comercio |
| Interpolación catastral sobre alturas reales de OSM en calle Mendoza (entre el 495 y el 1200) | **18 m** | la altura 827 cae ahí |
| Plus Code recomputado desde el pin | celda exacta | el código que publica la ficha se reproduce |
| Reverse geocoding | — | devuelve calle Mendoza |
| Vista satélite | — | el pin cae sobre calle Mendoza, cuadra 800, vereda impar (este), junto al cruce con Diagonal España |

**Corroboración de la sesión anterior.** Los archivos `pickup-candidato.json` y
`pickup-distancia-mendoza.json`, ya versionados en el repositorio, dejaron un candidato
independiente en `-38.9460539, -68.053236`, medido a 15 m del eje de calle Mendoza.
Está a **7 m** del punto de este contrato: muy dentro de la precisión declarada.

---

## Los cinco puntos descartados, y por qué

Están escritos **dentro del contrato**, no sólo acá, para que no vuelvan por
distracción. `check-location-contract.mjs` falla si alguno reaparece en código
ejecutable.

| Punto | Distancia | Por qué no |
| --- | --- | --- |
| **El punto viejo del repositorio** `-38.9516, -68.0591` | **793 m** | cae sobre Avenida Argentina junto a Parque Central; el reverse geocoding lo ubica en el radar de Av. Argentina y Roca. Es el que el sistema venía usando. |
| **Parque Central** | 936 m | no es la dirección del comercio |
| **«Mendoza 827» de Zapala** | **175 km** | es lo que devuelve un geocodificador público si no se le acota la ciudad. Otra ciudad. |
| **georef-ar / IGN** | 132 m | interpola sobre el tramo entero de la calle y se corre una cuadra |
| **POI «Mercado La Taba» de OSM** | 361 m | es otra sucursal, sobre otra calle |

Tampoco se usa **`qa_fixture`** —el sembrado de staging ya no escribe ese origen— ni
**Islas Malvinas 145**, que era un síntoma, no una dirección: el pin del retiro se
dibujaba 74 dp al sur de su coordenada y aparecía por ahí.

---

## Quién lee el contrato

Una sola escritura, arriba. Todo lo demás deriva.

```
                    data/business-location.json
                                │
        ┌───────────────┬───────┴────────┬────────────────┐
        ▼               ▼                ▼                ▼
  js/core/         app del Rider    supabase/        _work/ del video
  business-        (Dart, espejo)   staging-…sql     (compositor)
  location.js
        │
   ┌────┴─────┬──────────────┬────────────────┐
   ▼          ▼              ▼                ▼
 storefront  zonas de     destinos de    escenario del
 (js/config) entrega      prueba         mapa en demo
```

| Superficie | Qué toma | Se verifica en |
| --- | --- | --- |
| **Web / storefront** | dirección, punto del local, zona de entrega | `js/config.js` |
| **Ficha del comercio** | enlace «Cómo llegar» | `js/ui.js` + `index.html` |
| **Panel** | el mismo `businessConfig` que el storefront | `business-config-store.js` |
| **Tracking / demo** | origen, destino y ruta del recorrido de muestra | `js/sandbox/sandbox_map_scenario.js` |
| **Rider (Android)** | `kTabaBusinessIdentity`, respaldo del punto de retiro | `lib/core/config/business_config.dart` |
| **Google Maps** | enlace de búsqueda, de indicaciones y `geo:` | `business-location.js` |
| **Staging** | sembrado del punto de retiro con procedencia | `supabase/staging-rider-map-pickup-point.sql` |
| **Video** | escena 3 (Rider) y escena 4 (seguimiento) | `_work/` |

---

## Qué lo mantiene unido

`npm run location:check`, enganchado en `npm run check`. Compara cinco superficies en
cuatro lenguajes y falla si alguna se desvía:

1. el contrato declara sus diez campos, con `confidence` y `source` de la lista cerrada
   que acepta la base;
2. el módulo JS es un espejo exacto del JSON, campo por campo;
3. `js/config.js` y el escenario del mapa derivan del contrato, y la ruta demo empieza
   en el local y termina en el destino declarado;
4. la app del Rider declara la misma latitud y la misma longitud, y nombra al comercio;
5. el SQL de staging siembra el mismo punto —comparado con la precisión de
   `numeric(9,6)`, que es la que la columna guarda— y ya no lo escribe como
   `qa_fixture`;
6. ninguno de los puntos descartados aparece en código ejecutable. Los comentarios y
   la nota de procedencia **sí** pueden nombrarlos: explicar de qué se corrigió el
   punto es documentación, no una regresión, así que el chequeo quita comentarios
   antes de buscar y no al revés.

Además, la coordenada tiene dos guardas de cordura, una en cada lado: el chequeo y el
propio SQL abortan si el punto cae fuera de Neuquén Capital
(lat −38,982…−38,904 · lng −68,105…−67,955). Es la guarda que habría frenado el punto
de Zapala.

---

## El enlace a Google Maps abre por coordenadas

Buscar el texto «Mendoza 827» manda a **Zapala**, a 175 km. Una coordenada no se
busca: se abre.

```
https://www.google.com/maps/search/?api=1&query=-38.9460616%2C-68.0533209
https://www.google.com/maps/dir/?api=1&destination=-38.9460616%2C-68.0533209
geo:-38.9460616,-68.0533209?q=…(La Taba 2)
```

La prueba comprueba las tres cosas: que la URL lleve la coordenada, que **no** lleve
texto de dirección, y que salga del dominio de Google Maps. En la ficha del comercio,
el enlace sólo aparece si el punto está verificado; con una coordenada sin contrastar
preferimos no ofrecerlo antes que mandar al cliente a cualquier lado.

---

## El punto del cliente en la demo, aparte

No es el domicilio de nadie, y no puede llegar a serlo por descuido.

| | |
| --- | --- |
| **Destino** | Plaza de la Vida — un espacio público declarado |
| **Coordenada** | `-38.945584, -68.040579` |
| **Verificado como** | `leisure/playground` por reverse geocoding |
| **Recorrido** | 1441 m · ~4 min · OSRM sobre la red de calles de OpenStreetMap, simplificado a 12 vértices |

La prueba exige que ningún tramo de esa ruta supere los 600 m —una recta inventada por
encima de las manzanas se delataría ahí— y que el largo total quede entre 700 m y 3 km:
ni un punto pegado al local ni uno en otra ciudad.

En el checkout de la escena 4, el domicilio que carga el cliente antes decía «Avenida
Argentina 450»: además de ser un domicilio verosímil, caía junto a Parque Central. Hoy
es un punto rotulado como destino de demostración.

---

## Cómo se sube a verificación humana

Un solo escalón, y no se puede dar desde un escritorio.

Con alguien del comercio delante, confirmando el pin contra la puerta:

```bash
node scripts/set-pickup-point.mjs <lat> <lng> \
  --origen=business_verified --confirmado-por-humano \
  --confianza=high --precision=<metros> --reemplazar
```

Después, en el contrato: `source` → `business_verified`, `human_verified` → `true`,
`accuracy_meters` → la precisión real, y `verified_at` → esa fecha. `npm run check`
verifica que las cinco superficies vuelvan a coincidir.

**Lo que un cambio de punto arrastra:** el trigger `rider_map_capture_order_location`
fotografía la ubicación **en el alta del pedido**, y esa instantánea es inmutable a
propósito. Cambiar el punto afecta a los pedidos siguientes, nunca a los ya emitidos.
Los anteriores al 2026-08-08 llevan fotografiado el punto equivocado de Parque Central.
Además, al escribir un punto nuevo el sembrado invalida cualquier comprobación de
presencia anterior: lo que se había comprobado era la cercanía a **otra** coordenada.

---

## Estado de las evidencias

| Afirmación | Estado |
| --- | --- |
| La dirección postal es Mendoza 827, Neuquén Capital | confirmada por el comercio |
| La coordenada cae en la cuadra 800 de Mendoza, vereda impar | contrastada, 5 fuentes |
| La coordenada es la puerta exacta del local | **no afirmado** |
| El punto anterior estaba a 793 m | medido |
| Buscar «Mendoza 827» sin acotar devuelve Zapala | medido, 175 km |
