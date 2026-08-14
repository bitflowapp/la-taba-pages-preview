// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · CONFIGURACIÓN CENTRAL.
// -----------------------------------------------------------------------------
// Todos los números que gobiernan la personalización viven acá. La regla es la
// misma que la del resto del storefront: ajustar una decisión comercial no
// puede exigir tocar veinte componentes. Cambiar un peso es editar UNA línea de
// este archivo; los tests de `tests/growth-*.test.mjs` fijan el comportamiento
// que estos valores producen.
//
// Nada de este módulo decide QUÉ se vende ni A QUÉ PRECIO: sólo cuánto pesa
// cada señal al elegir, entre piezas comerciales ya válidas, cuál mostrar.
// ─────────────────────────────────────────────────────────────────────────────

// Pesos por señal. La escala es relativa: importa el orden y la proporción
// (una compra vale ~7 vistas de categoría), no el número absoluto.
// `remove_from_cart` y `promo_dismiss` son negativos a propósito: sacar algo
// del carrito o cerrar una pieza es información, no ruido.
export const SIGNAL_WEIGHTS = Object.freeze({
  category_view: 2,
  search_match: 4,
  product_view: 5,
  add_to_cart: 10,
  remove_from_cart: -6,
  purchase: 15,
  promo_click: 6,
  promo_dismiss: -8,
});

// Tope de score acumulado por clave (categoría/marca/producto). Sin tope, diez
// aperturas accidentales de la misma ficha dominan el perfil para siempre; con
// tope, el interés satura y las señales nuevas de otros rubros pueden competir.
export const INTENT_SCORE_CAP = 60;

// Decay temporal por semivida. `score * 0.5^(Δt/semivida)`: determinista,
// barato (una potencia por clave) y fácil de razonar — a una semivida el
// interés vale la mitad, a dos vale un cuarto.
//   · LARGO PLAZO (localStorage): lo que la persona suele comprar.
//   · SESIÓN (sessionStorage): lo que está buscando AHORA.
export const LONG_TERM_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000; // 14 días
export const SESSION_HALF_LIFE_MS = 30 * 60 * 1000; // 30 minutos

// La intención de la sesión actual pesa el doble que la histórica: quien entró
// a mirar vinos hoy no quiere que tres compras viejas de gaseosas lo tapen.
export const SESSION_BLEND_MULTIPLIER = 2;

// Normalización con saturación suave: score/(score+PIVOT) → 0..1. Con PIVOT=8,
// un score de 8 vale 0,5 y uno de 24 vale 0,75: los primeros gestos mueven
// mucho, la obsesión mueve poco (anti-monopolio, §diversidad).
export const AFFINITY_NORM_PIVOT = 8;

// Umbral de afinidad NORMALIZADA (0..1) para considerar que hay interés real
// en una categoría. 0.3 ≈ score efectivo ~3.4: una visita a la categoría más
// una ficha abierta ya lo cruzan dentro de la sesión.
export const CATEGORY_INTENT_THRESHOLD = 0.3;

// Cotas de almacenamiento: el perfil es un resumen, no una bitácora. Por mapa
// se conservan las N claves de mayor score efectivo; el resto se poda al
// escribir. Con ~14 categorías reales, 24 es holgado sin ser infinito.
export const INTENT_MAX_KEYS = Object.freeze({
  categories: 24,
  brands: 32,
  products: 48,
});

// Score efectivo por debajo de este valor se poda al persistir: ya no puede
// influir en ningún ranking y sólo ocuparía bytes.
export const INTENT_PRUNE_EPSILON = 0.05;

// ── Frequency capping ────────────────────────────────────────────────────────
export const FREQUENCY = Object.freeze({
  // Impresiones sin click que se toleran antes de empezar a penalizar.
  freeImpressions: 2,
  // Penalización por cada impresión no correspondida por click, en puntos de
  // ranking (la escala del ranking es ~0-100).
  penaltyPerImpression: 4,
  // Tope de la penalización blanda.
  maxPenalty: 25,
  // Con esta cantidad de impresiones sin click la campaña queda EXCLUIDA…
  hardCapImpressions: 8,
  // …hasta que pase el cooldown desde la última impresión.
  hardCapCooldownMs: 24 * 60 * 60 * 1000, // 24 h
  // Cerrar/descartar una pieza la silencia por más tiempo que ignorarla.
  dismissCooldownMs: 72 * 60 * 60 * 1000, // 72 h
  // Un click "perdona" este múltiplo de impresiones acumuladas.
  impressionsForgivenPerClick: 4,
  // Cota de campañas con contadores en storage (FIFO por última actividad).
  maxTrackedCampaigns: 60,
});

// ── Ranking ──────────────────────────────────────────────────────────────────
// Escala pensada para leerse como puntos (~0-100 el total típico). El desglose
// por factor queda en `explain` para poder responder "por qué salió esta".
export const RANKING_WEIGHTS = Object.freeze({
  // Afinidad de intención (normalizada 0..1) hacia las categorías/marca/
  // productos que la campaña toca.
  intent: 45,
  // Prioridad comercial declarada por la campaña (0-100 → 0..1).
  priority: 25,
  // La campaña complementa lo que ya hay en el carrito (fernet → cola/hielo).
  complement: 20,
  // Una promoción REAL activa (contrato validado) vale más que una editorial.
  promotion: 18,
  // Contexto horario declarado por la campaña (noche/finde). Suave a
  // propósito: el contexto acompaña, no decide.
  context: 6,
  // Penalización por repetir categoría dentro de una misma selección
  // multi-slot (diversidad). Se aplica a partir del segundo slot.
  diversityRepeatPenalty: 30,
  // Toda campaña que llega a ranking ya pasó elegibilidad de catálogo vivo.
  // Se deja explícito en el desglose para que disponibilidad no sea una
  // inferencia silenciosa del destino.
  availability: 4,
});

// Pesos del primer nivel de merchandising de producto. La afinidad de
// categoría pesa más que marca/SKU para que una intención dominante ordene la
// góndola completa sin convertirla en una recomendación de un solo producto.
export const PRODUCT_RANKING_WEIGHTS = Object.freeze({
  categoryIntent: 45,
  brandIntent: 22,
  productIntent: 30,
  merchandising: 6,
  availability: 8,
  diversityRepeatBrand: 8,
  diversityRepeatCategory: 4,
});

// Ventana de rotación determinista para desempates exactos en cold start: el
// índice rota por día calendario UTC. Sin Math.random: mismo día, misma
// vidriera; otro día, otra pieza entre las igualadas.
export const ROTATION_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── Señales ──────────────────────────────────────────────────────────────────
// Una búsqueda cuenta como señal cuando la query estabilizada tiene al menos
// este largo y matchea productos reales del catálogo.
export const SEARCH_MIN_QUERY_LENGTH = 2;
// Milisegundos sin tipear para considerar la búsqueda "asentada" (sólo UI;
// el core recibe la señal ya asentada).
export const SEARCH_SETTLE_MS = 600;
// Cota de categorías/marcas bumpeadas por UNA búsqueda: una query genérica
// que matchea medio catálogo no puede inflar todos los rubros a la vez.
export const SEARCH_MAX_MATCHED_KEYS = 3;

// ── Analytics first-party ────────────────────────────────────────────────────
export const ANALYTICS = Object.freeze({
  // Cola local acotada (FIFO). Suficiente para depurar un funnel de sesión;
  // jamás una bitácora eterna. El transporte real se conecta por interfaz.
  maxQueuedEvents: 200,
  storageKey: 'la_taba_growth_events_v1',
});

// ── Claves de storage propias del motor ─────────────────────────────────────
// Mismo esquema de nombres que STORAGE_KEYS del resto de la app. El sufijo
// showcase aísla la vidriera comercial igual que en config.js.
export const GROWTH_STORAGE_KEYS = Object.freeze({
  longTermIntent: 'la_taba_growth_intent_v1',
  sessionIntent: 'la_taba_growth_session_v1',
  exposure: 'la_taba_growth_exposure_v1',
});

export const GROWTH_SHOWCASE_STORAGE_KEYS = Object.freeze({
  longTermIntent: 'la_taba_showcase_growth_intent_v1',
  sessionIntent: 'la_taba_showcase_growth_session_v1',
  exposure: 'la_taba_showcase_growth_exposure_v1',
});

// Esquema del perfil persistido. Si el guardado no coincide, se descarta
// entero: un perfil corrupto o de otra versión no puede romper el arranque.
export const INTENT_SCHEMA_VERSION = 1;
