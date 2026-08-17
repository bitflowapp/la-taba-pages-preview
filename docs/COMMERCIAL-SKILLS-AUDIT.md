# Auditoría de skills externas · capa comercial

Relevamiento del 2026-08-14. Objetivo: ver qué hay hecho antes de escribir, y
tomar sólo lo que sobrevive a una lectura crítica.

**Nada se instaló, se descargó ni se ejecutó.** Todo el relevamiento se hizo
leyendo las páginas públicas de cada repositorio. Ningún script externo corrió en
esta máquina, no se instaló ningún paquete y no se ejecutó ningún instalador.

## Criterio de clasificación

| Clase | Significa |
|---|---|
| `USE` | se adopta tal cual, como norma o como dependencia documental |
| `ADAPT` | la idea sirve; se reescribe para TABA sin copiar el paquete |
| `REFERENCE ONLY` | se leyó, aporta contexto, no entra al repo |
| `REJECT` | no entra, con motivo |

## Candidatas

### 1. Especificación oficial de Agent Skills — `USE`

- **Origen**: documentación de la plataforma (`platform.claude.com`,
  `code.claude.com`) y el estándar abierto en `agentskills.io`.
- **Autor**: Anthropic. **Licencia**: documentación pública.
- **Aporta**: el contrato de `SKILL.md` — campos de frontmatter, límites
  (`name` ≤ 64 caracteres, sólo minúsculas/números/guiones, sin las palabras
  reservadas; `description` ≤ 1024 caracteres), y el modelo de carga en tres
  niveles (metadata siempre / cuerpo al activarse / `references/` a demanda).
- **Decisión**: el paquete se ciñe a los **seis campos del estándar**
  (`name`, `description`, `license`, `compatibility`, `metadata`,
  `allowed-tools`). Es lo que acepta toda vía de distribución; un campo extra
  falla con error duro al empaquetar. Se usan sólo `name`, `description` y
  `allowed-tools`.
- **Riesgo**: ninguno.

### 2. `anthropics/skills` — `REFERENCE ONLY`

- **Origen**: `github.com/anthropics/skills`. **Licencia**: Apache 2.0 para las
  skills abiertas; las de documentos (docx/pdf/pptx/xlsx) son *source-available*,
  no open source.
- **Actividad**: repositorio activo, muy usado (decenas de miles de forks).
- **Contenido**: skills creativas, técnicas y de empresa. **Ninguna es
  comercial/retail.**
- **Aporta**: `skill-creator` — convenciones de autoría que sí se adoptaron:
  cuerpo del `SKILL.md` acotado (guía: bajo ~500 líneas; acá se apuntó a ~120),
  `references/` para lo largo, `description` "empujada" con los contextos de
  activación, explicar el *porqué* en vez de dar órdenes sueltas, y evaluar la
  skill con casos en vez de darla por buena porque está bien escrita.
- **Decisión**: se adoptan las convenciones; no se copia ningún archivo.
- **Riesgo**: el flujo de evaluación de `skill-creator` asume subagentes y
  scripts propios; acá se hizo la versión manual y documentada.

### 3. `mardab96/ecommerce-claude-skills` — `ADAPT`

- **Origen**: `github.com/mardab96/ecommerce-claude-skills` (AdLume).
  **Licencia**: MIT. **Actividad**: pocos commits; repositorio joven.
- **Contenido**: 20 skills de e-commerce (auditoría de catálogo, QA de feed,
  búsqueda y merchandising, margen, promociones, cohortes, churn, readiness) más
  7 scripts Python de biblioteca estándar y utilidades de validación.
- **Qué aporta, y se adaptó**:
  - **Estándar de salida**: evidencia / severidad / confianza / impacto /
    esfuerzo / decisión de dueño, con vocabulario cerrado. Es lo que vuelve
    comparables dos auditorías del mismo catálogo. Adaptado y traducido en
    `taba-commercial-qa/references/gate-y-veredicto.md`.
  - **Separar evidencia de hipótesis** y **nombrar el dato que falta** como
    categorías de primera clase, no como notas al pie.
  - **"Contar las filas antes de decidir cómo trabajar"**: por encima de cierto
    tamaño no se lee el export y se describe lo visto; se deriva con una
    herramienta. Y una lectura muestreada nunca se presenta como auditoría
    completa. Esta regla entró casi literal porque describe un modo de fallar
    que este repo ya vio.
  - **"Un atributo ausente del export no es un atributo ausente del catálogo"**.
- **Qué solapa con TABA**: la mitad del paquete asume una tienda tipo Shopify con
  feed de Shopping, marketplace, suscripciones y contracargos. TABA no tiene nada
  de eso, y sus reglas duras —precio pendiente, pack vs combo, +18, combo
  derivado— no existen ahí.
- **Riesgos**: 7 scripts Python que **no se leyeron ni se ejecutaron**; instalar
  el paquete metería 20 skills compitiendo por activación con las de TABA y
  diluiría la autoridad de cada regla.
- **Decisión**: no se instala. Se adapta el estándar de salida, con la
  procedencia registrada en el propio archivo.

### 4. `coreyhaines31/marketingskills` — `REFERENCE ONLY`

- **Licencia**: MIT. **Actividad**: alta (cientos de commits).
- **Contenido**: CRO, copywriting, onboarding, paywalls, analytics, A/B testing,
  prevención de churn. Markdown, con scripts de validación.
- **Aporta**: buen recorte por superficie (una skill por momento del funnel), que
  confirmó la decisión de hacer skills chicas en vez de una sola "comercial".
- **Por qué no entra**: está formado para SaaS/B2B —registro, activación,
  paywall, suscripción— y no aparecen guardas contra afirmar datos que no
  existen, que es justamente el eje del paquete de TABA.

### 5. `thatrebeccarae/claude-marketing` — `REFERENCE ONLY`

- **Licencia**: MIT. **Actividad**: reciente. Probado con Claude Code v2.1.
- **Contenido**: packs de marketing DTC con integración a Klaviyo, Shopify, GA4 y
  Looker Studio.
- **Aporta**: una postura de privacidad que vale la pena copiar como principio —
  trabajar con **agregados y no con datos de clientes individuales**, sin
  almacenamiento persistente del análisis, claves fuera del repo y acceso de sólo
  lectura por defecto. Está reflejada en `taba-commercial-analytics`.
- **Por qué no entra**: depende de credenciales de plataformas que TABA no usa.
  Instalarlo agrega superficie de secretos a cambio de nada.

### 6. `wiebekaai/ecommerce-skills` — `REJECT`

- **Licencia**: no declarada. **Actividad**: mínima (pocos commits).
- **Contenido**: Shopify, Sanity y Salesforce Commerce Cloud vía scripts Bun que
  leen y **escriben** en sistemas externos, con tokens en `.env`.
- **Motivo del rechazo**: sin licencia, con credenciales de administración de
  tiendas, escritura cruzada entre sistemas y generación de scripts temporales.
  Es exactamente el perfil "útil pero excesivamente invasivo": la idea de
  encadenar exportar → transformar → importar se puede tener sin ceder tokens.

### 7. Skills de automatización de plataformas (`shopify`, `square`, `stripe`, `hubspot`, `salesforce`, `google-analytics`) — `REJECT`

- **Origen**: `ComposioHQ/awesome-claude-skills` y equivalentes.
  **Licencia**: Apache 2.0.
- **Motivo del rechazo**: automatizan plataformas que TABA no usa, y varias
  operan sobre **pagos** con credenciales de escritura. TABA cobra con Mercado
  Pago y su integración ya tiene documentación y compuertas propias. Sumar una
  skill genérica de pagos agrega un camino para mover dinero sin el gate del
  repo.

### 8. Colecciones agregadoras (`VoltAgent/awesome-agent-skills`, `GetBindu/...`, `alirezarezvani/claude-skills`, colecciones "1000+ skills") — `REJECT`

- **Motivo**: catálogos de cientos o miles de skills de procedencia mixta y
  mantenimiento desigual. Instalar en bloque contradice la regla del encargo —no
  bajar 30 skills indiscriminadamente— y contradice el modelo de seguridad: una
  skill es código y texto que dirige a un agente, y se audita antes de confiar.
- Sirvieron para el descubrimiento, y ahí termina su función.

### 9. Fidelización / ledger de puntos — **no se encontró candidata**

No apareció ninguna skill pública que trate puntos de fidelidad como un libro de
asientos server-side. Lo que hay son skills de *campañas* de retención. Por eso
`taba-loyalty` se escribió desde principios de sistemas de valor (asientos
inmutables, idempotencia, reversión por contraasiento, autoridad del servidor) y
no adaptando nada.

## Resumen

| Clase | Candidatas |
|---|---|
| `USE` | especificación oficial de Agent Skills |
| `ADAPT` | `mardab96/ecommerce-claude-skills` (sólo el estándar de salida y la disciplina de muestreo) |
| `REFERENCE ONLY` | `anthropics/skills`, `coreyhaines31/marketingskills`, `thatrebeccarae/claude-marketing` |
| `REJECT` | `wiebekaai/ecommerce-skills`, skills de automatización de plataformas, colecciones agregadoras |

## Postura de seguridad aplicada

- Cero scripts externos ejecutados; cero paquetes instalados; cero descargas.
- Ninguna skill del paquete de TABA ejecuta código externo ni hace red.
- Las skills externas se leyeron por su página pública, no se clonaron.
- Se prefirió reescribir sobre importar: una regla propia se puede auditar contra
  el código de este repo; una importada arrastra supuestos de otra tienda.

## Lo que sigue valiendo la pena mirar

- El repositorio oficial, cuando publique skills de dominio comercial.
- El estándar `agentskills.io`, por si cambian los campos aceptados.
- `mardab96/ecommerce-claude-skills`, si madura: sus scripts deterministas para
  catálogos grandes son la parte más interesante, y valdría leerlos línea por
  línea antes de considerar la idea (no el archivo).
