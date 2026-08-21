/*
 * Tema nocturno TABA2 para el mapa de seguimiento.
 *
 * El estilo público sigue siendo el Positron claro de OpenFreeMap: el tema es
 * un POST-PROCESO que recolorea las capas ya cargadas, aplicado en el evento
 * `load` del mapa y ANTES de revelar el canvas. Ese orden es lo que hace que el
 * primer frame visible ya sea grafito, sin flash claro, y sin volver asíncrono
 * el montaje ni agregar un fetch propio: si algo de esto fallara, lo peor que
 * puede pasar es el mapa claro de siempre — un mapa legible, nunca uno roto.
 *
 * La paleta parte del mismo negro del shell (`--taba-ink`, #14161a) para que el
 * mapa se funda con la interfaz en vez de flotar como un parche. La jerarquía
 * vial se cuenta con luminancia (calle menor < avenida < autopista) y la
 * legibilidad de los nombres NO se sacrifica por oscurecer: cada color de texto
 * está elegido para rendir al menos ~4,5:1 sobre el fondo, con halos grafito
 * que los despegan de la trama. El único acento cálido del lienzo es el dorado
 * apagado de los nombres de avenidas: el resto del color queda reservado para
 * la ruta roja y los marcadores, que son la historia que el tracking cuenta.
 */

export const TABA_MAP_BACKGROUND = '#14161a';
export const TABA_MAP_LABEL_HALO = '#111318';

/*
 * Overrides por id EXACTO del estilo Positron de OpenFreeMap (55 capas,
 * volcadas y clasificadas una por una). Si OpenFreeMap agregara capas nuevas,
 * el fallback por `source-layer` de abajo las acerca al tema; si renombrara
 * todo, el resultado es el estilo claro original: fail-open a legible.
 */
const PAINT_BY_LAYER_ID = Object.freeze({
  background: { 'background-color': TABA_MAP_BACKGROUND },

  // Superficies
  park: { 'fill-color': '#182019' },
  water: { 'fill-color': '#0f151c' },
  landcover_ice_shelf: { 'fill-color': '#181b21' },
  landcover_glacier: { 'fill-color': '#181b21' },
  landuse_residential: { 'fill-color': '#171a1f' },
  landcover_wood: { 'fill-color': '#172018' },
  waterway: { 'line-color': '#1b2733' },
  building: { 'fill-color': '#1b1f26', 'fill-outline-color': '#242a33' },
  road_area_pier: { 'fill-color': '#1b1f25' },
  road_pier: { 'line-color': '#1b1f25' },
  'aeroway-area': { 'fill-color': '#1e222a' },
  'aeroway-taxiway': { 'line-color': '#1e222a' },
  'aeroway-runway': { 'line-color': '#1e222a' },
  'aeroway-runway-casing': { 'line-color': '#12151a' },

  // Vías: la jerarquía se lee por luminancia creciente.
  highway_path: { 'line-color': '#262b32' },
  highway_minor: { 'line-color': '#2a3038' },
  highway_major_casing: { 'line-color': '#0f1114' },
  highway_major_inner: { 'line-color': '#39414c' },
  highway_major_subtle: { 'line-color': '#242930' },
  highway_motorway_casing: { 'line-color': '#0f1114' },
  highway_motorway_inner: { 'line-color': '#454e5b' },
  highway_motorway_subtle: { 'line-color': '#2a303a' },
  highway_motorway_bridge_casing: { 'line-color': '#0f1114' },
  highway_motorway_bridge_inner: { 'line-color': '#454e5b' },
  tunnel_motorway_casing: { 'line-color': '#171a20' },
  tunnel_motorway_inner: { 'line-color': '#20242c' },
  railway: { 'line-color': '#262a31' },
  railway_dashline: { 'line-color': '#31363e' },
  railway_transit: { 'line-color': '#262a31' },
  railway_transit_dashline: { 'line-color': '#31363e' },
  railway_service: { 'line-color': '#262a31' },
  railway_service_dashline: { 'line-color': '#31363e' },
  boundary_3: { 'line-color': '#3d434d' },
  boundary_2: { 'line-color': '#444b56' },
  boundary_disputed: { 'line-color': '#444b56' },

  // Nombres. Halo grafito universal; el color sube con la jerarquía del lugar.
  waterway_line_label: { 'text-color': '#6f8ba1', 'text-halo-color': TABA_MAP_LABEL_HALO },
  water_name_point_label: { 'text-color': '#6f8ba1', 'text-halo-color': TABA_MAP_LABEL_HALO },
  water_name_line_label: { 'text-color': '#6f8ba1', 'text-halo-color': TABA_MAP_LABEL_HALO },
  'highway-name-path': { 'text-color': '#7f8894', 'text-halo-color': TABA_MAP_LABEL_HALO },
  'highway-name-minor': { 'text-color': '#98a1ad', 'text-halo-color': TABA_MAP_LABEL_HALO },
  // El único dorado del lienzo: los nombres de las avenidas. 7:1 sobre el fondo.
  'highway-name-major': { 'text-color': '#c9a45f', 'text-halo-color': TABA_MAP_LABEL_HALO },
  airport: { 'text-color': '#8b93a0', 'text-halo-color': TABA_MAP_LABEL_HALO },
  label_other: { 'text-color': '#79818d', 'text-halo-color': TABA_MAP_LABEL_HALO },
  label_village: { 'text-color': '#b6bdc7', 'text-halo-color': TABA_MAP_LABEL_HALO },
  label_town: { 'text-color': '#c6ccd5', 'text-halo-color': TABA_MAP_LABEL_HALO },
  label_state: { 'text-color': '#79818d', 'text-halo-color': TABA_MAP_LABEL_HALO },
  label_city: { 'text-color': '#e2e6ea', 'text-halo-color': TABA_MAP_LABEL_HALO },
  label_city_capital: { 'text-color': '#eef0f3', 'text-halo-color': TABA_MAP_LABEL_HALO },
  label_country_3: { 'text-color': '#9aa3af', 'text-halo-color': TABA_MAP_LABEL_HALO },
  label_country_2: { 'text-color': '#9aa3af', 'text-halo-color': TABA_MAP_LABEL_HALO },
  label_country_1: { 'text-color': '#9aa3af', 'text-halo-color': TABA_MAP_LABEL_HALO },
});

/*
 * Los escudos de ruta (RP7, RN22…) se EXCLUYEN a propósito: su texto está
 * calibrado contra la chapa clara del sprite, y oscurecerlo lo volvería
 * ilegible dentro del propio escudo. Es la aplicación directa de "no
 * sacrificar legibilidad por oscurecer".
 */
const EXCLUDED_LAYER_PREFIXES = Object.freeze(['highway-shield', 'road_shield']);

/* Fallback por familia para capas que el volcado no conocía. */
const PAINT_BY_SOURCE_LAYER = Object.freeze({
  'fill · water': { 'fill-color': '#0f151c' },
  'fill · park': { 'fill-color': '#182019' },
  'fill · landcover': { 'fill-color': '#171a1f' },
  'fill · landuse': { 'fill-color': '#171a1f' },
  'fill · building': { 'fill-color': '#1b1f26' },
  'fill · transportation': { 'fill-color': '#1b1f25' },
  'fill · aeroway': { 'fill-color': '#1e222a' },
  'line · waterway': { 'line-color': '#1b2733' },
  'line · transportation': { 'line-color': '#2a3038' },
  'line · aeroway': { 'line-color': '#1e222a' },
  'line · boundary': { 'line-color': '#3d434d' },
});

const SYMBOL_FALLBACK = Object.freeze({
  'text-color': '#98a1ad',
  'text-halo-color': TABA_MAP_LABEL_HALO,
});

export function isExcludedLayer(layerId) {
  const id = String(layerId || '');
  return EXCLUDED_LAYER_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/**
 * Decide los overrides de pintura para las capas de un estilo.
 *
 * Función pura: recibe la lista de capas (id/type/source-layer alcanzan) y
 * devuelve `{ layerId, property, value }[]`. No conoce MapLibre: eso la hace
 * testeable contra el volcado real del estilo sin red ni WebGL.
 */
export function tabaMapPaintOverrides(layers = []) {
  const overrides = [];
  for (const layer of Array.isArray(layers) ? layers : []) {
    const id = String(layer?.id || '');
    if (!id || isExcludedLayer(id)) continue;

    const exact = PAINT_BY_LAYER_ID[id];
    if (exact) {
      for (const [property, value] of Object.entries(exact)) {
        overrides.push({ layerId: id, property, value });
      }
      continue;
    }

    const familyKey = `${layer?.type} · ${layer?.['source-layer'] || ''}`;
    const family = PAINT_BY_SOURCE_LAYER[familyKey];
    if (family) {
      for (const [property, value] of Object.entries(family)) {
        overrides.push({ layerId: id, property, value });
      }
      continue;
    }
    if (layer?.type === 'symbol') {
      for (const [property, value] of Object.entries(SYMBOL_FALLBACK)) {
        overrides.push({ layerId: id, property, value });
      }
    }
    if (layer?.type === 'background') {
      overrides.push({ layerId: id, property: 'background-color', value: TABA_MAP_BACKGROUND });
    }
  }
  return overrides;
}

/**
 * Aplica el tema sobre un mapa ya cargado. Devuelve cuántos overrides entraron.
 *
 * Cada override va en su propio try: una capa que MapLibre rechace no puede
 * costar el tema entero, y mucho menos el mapa.
 */
export function applyTabaMapTheme(map) {
  if (!map?.getStyle || !map?.setPaintProperty) return 0;
  let style = null;
  try {
    style = map.getStyle();
  } catch (_) {
    return 0;
  }
  let applied = 0;
  for (const { layerId, property, value } of tabaMapPaintOverrides(style?.layers)) {
    try {
      map.setPaintProperty(layerId, property, value);
      applied += 1;
    } catch (_) {
      // Capa desconocida o propiedad inválida: se conserva su pintura original.
    }
  }
  return applied;
}
