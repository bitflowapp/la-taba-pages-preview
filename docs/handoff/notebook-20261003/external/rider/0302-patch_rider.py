# -*- coding: utf-8 -*-
"""v2 · Agrega al prototipo del rider las 5 pantallas que faltaban de los 25 flujos."""
import io, sys

p = 'prototypes/prototype-rider-android.html'
s = io.open(p, encoding='utf-8').read()

CHEV = '<svg class="t-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
ROW = 'grid-template-columns:34px 1fr auto'

nuevas = """
  // ── v2 · Flujo 2 · Sesión expirada ────────────────────────────────────────
  expired: {
    title:"Sesión expirada", back:false, shift:false,
    banner:`<div class="r-banner r-banner--offline"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v5l3 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>Tu sesión venció · tus acciones NO se perdieron</div>`,
    body:`<div class="r-pad">
      <div class="t-card" style="padding:16px;display:grid;gap:8px">
        <strong class="t-title-m">Volvé a ingresar para continuar</strong>
        <span class="t-body-s t-muted">Por seguridad la sesión vence cada tanto. El pedido activo y todo lo que ya registraste siguen guardados en este teléfono.</span>
      </div>
      <p class="t-group-label">Pendiente de enviar</p>
      <div class="t-group" style="padding:10px 14px">
        <div class="r-step is-done"><span class="r-dot">✓</span><span><b>Retiro confirmado</b><small>14:38 · esperando sesión</small></span></div>
        <div class="r-step is-done"><span class="r-dot">✓</span><span><b>Llegando</b><small>14:41 · esperando sesión</small></span></div>
      </div>
      <label style="display:grid;gap:6px"><span class="t-label">Contraseña</span><span class="t-field"><input type="password" autocomplete="current-password" placeholder="••••••••" /></span></label>
      <p class="t-caption">Se reenvían solas apenas vuelvas a entrar. No hace falta repetir nada.</p>
    </div>`,
    actions:`<button class="t-btn t-btn--primary t-btn--lg t-btn--block" type="button" data-go="ontheway">Ingresar y continuar</button>`
  },

  // ── v2 · Flujo 19 · Cancelación del local ─────────────────────────────────
  cancelled: {
    title:"Pedido cancelado", back:false, shift:false,
    banner:`<div class="r-banner" style="background:var(--t-danger-100);color:var(--t-danger-700)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="m9 9 6 6M15 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>El local canceló #A-1042 a las 14:44</div>`,
    body:`<div class="r-pad">
      <div class="t-card" style="padding:16px;display:grid;gap:8px">
        <span class="t-pill t-pill--danger" style="justify-self:start"><i class="t-dot"></i>Cancelado</span>
        <strong class="t-title-m">No sigas con esta entrega</strong>
        <span class="t-body-s t-muted">Motivo informado por el local: <b>el cliente canceló por teléfono</b>.</span>
      </div>
      <p class="t-group-label">Qué pasa con lo que ya hiciste</p>
      <div class="t-group">
        <div class="t-row" style="__ROW__"><span class="t-row-icon">${IC.box}</span><span class="t-row-copy"><strong>Tenés el pedido encima</strong><small>Hay que devolverlo al local</small></span><span class="t-pill t-pill--warn"><i class="t-dot"></i>Devolver</span></div>
        <div class="t-row" style="__ROW__"><span class="t-row-icon">${IC.pin}</span><span class="t-row-copy"><strong>Ubicación detenida</strong><small>Dejaste de compartir posición</small></span><span class="t-pill t-pill--neutral"><i class="t-dot"></i>Off</span></div>
        <div class="t-row" style="__ROW__"><span class="t-row-icon">${IC.store}</span><span class="t-row-copy"><strong>El viaje queda registrado</strong><small>El local lo ve en el cierre del día</small></span><span class="t-pill t-pill--ok"><i class="t-dot"></i>OK</span></div>
      </div>
    </div>`,
    actions:`<button class="t-btn t-btn--primary t-btn--lg t-btn--block" type="button" data-go="atstore">Volver al local a devolver</button>
      <div class="r-sec"><button class="t-btn t-btn--secondary" type="button" data-go="home">Terminar y volver al turno</button></div>`
  },

  // ── v2 · Flujo 20 · Cliente ausente, con protocolo de espera ──────────────
  absent: {
    title:"Cliente ausente", back:true, shift:false,
    body:`<div class="r-pad">
      <div class="t-card" style="padding:16px;display:grid;gap:8px">
        <span class="t-pill t-pill--warn" style="justify-self:start"><i class="t-dot"></i>Esperando al cliente</span>
        <strong class="r-bignum" style="font-size:44px">4:12</strong>
        <span class="t-body-s t-muted">Esperá <b>5 minutos</b> antes de dar la entrega por fallida. El local ya fue avisado y está intentando contactarlo.</span>
      </div>
      <p class="t-group-label">Antes de cerrar, probá</p>
      <div class="t-group">
        <button class="t-row" type="button"><span class="t-row-icon t-row-icon--accent"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4h3l1.6 4-2 1.4a12 12 0 0 0 5 5L14 12.4l4 1.6v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3 6.2 2 2 0 0 1 5 4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></span><span class="t-row-copy"><strong>Llamar al cliente</strong><small>Segundo intento</small></span><span class="t-row-value">1 hecho</span>__CHEV__</button>
        <button class="t-row" type="button"><span class="t-row-icon">${IC.pin}</span><span class="t-row-copy"><strong>Verificar la dirección</strong><small>Ministro González 233 · timbre 3B</small></span><span></span>__CHEV__</button>
        <button class="t-row" type="button"><span class="t-row-icon">${IC.store}</span><span class="t-row-copy"><strong>Avisar al local</strong><small>Que decida qué hacer</small></span><span class="t-pill t-pill--ok"><i class="t-dot"></i>Avisado</span></button>
      </div>
      <p class="t-caption">Si nadie atiende, la entrega queda como <b>no entregada</b>, con la hora y la ubicación registradas. No es una falta tuya: queda auditado.</p>
    </div>`,
    actions:`<button class="t-btn t-btn--primary t-btn--lg t-btn--block" type="button" data-go="arriving">El cliente apareció</button>
      <div class="r-sec"><button class="t-btn t-btn--danger" type="button" data-go="home">Registrar no entregado…</button></div>`
  },

  // ── v2 · Pantalla · Historial del día ─────────────────────────────────────
  history: {
    title:"Entregas de hoy", back:true, shift:false,
    body:`<div class="r-pad">
      <div class="t-card" style="padding:14px;display:flex;gap:20px">
        <span style="display:grid"><strong class="r-bignum">6</strong><small class="t-caption">Entregadas</small></span>
        <span style="display:grid"><strong class="r-bignum">1</strong><small class="t-caption">Incidencias</small></span>
        <span style="display:grid"><strong class="r-bignum t-num">$ 184.300</strong><small class="t-caption">Efectivo</small></span>
      </div>
      <p class="t-group-label">Cerradas</p>
      <div class="t-group">
        <div class="t-row" style="__ROW__"><span class="t-row-icon" style="background:var(--t-success-100);color:var(--t-success-700)">✓</span><span class="t-row-copy"><strong class="t-num">#A-1041</strong><small>14:02 · entregado con código</small></span><span class="t-row-value t-num">$ 20.000</span></div>
        <div class="t-row" style="__ROW__"><span class="t-row-icon" style="background:var(--t-success-100);color:var(--t-success-700)">✓</span><span class="t-row-copy"><strong class="t-num">#A-1038</strong><small>13:31 · entregado con código</small></span><span class="t-row-value t-num">$ 47.500</span></div>
        <div class="t-row" style="__ROW__"><span class="t-row-icon" style="background:var(--t-warning-100);color:var(--t-warning-700)">!</span><span class="t-row-copy"><strong class="t-num">#A-1036</strong><small>12:58 · cliente ausente</small></span><span class="t-row-value t-num">$ 23.000</span></div>
        <div class="t-row" style="__ROW__"><span class="t-row-icon" style="background:var(--t-success-100);color:var(--t-success-700)">✓</span><span class="t-row-copy"><strong class="t-num">#A-1034</strong><small>12:20 · entregado con código</small></span><span class="t-row-value t-num">$ 31.500</span></div>
      </div>
      <p class="t-caption">El historial guarda número, hora, importe y estado. <b>No guarda datos del cliente</b>: se borran al cerrar cada pedido.</p>
    </div>`,
    actions:`<button class="t-btn t-btn--secondary t-btn--lg t-btn--block" type="button" data-go="home">Volver al turno</button>`
  },

  // ── v2 · Pantalla · Perfil y configuración ────────────────────────────────
  settings: {
    title:"Perfil", back:true, shift:false,
    body:`<div class="r-pad">
      <div class="t-card" style="padding:14px;display:grid;gap:2px">
        <strong class="t-title-m">D. Millán</strong>
        <span class="t-caption">Rider · TABA Neuquén Centro</span>
      </div>
      <p class="t-group-label">Privacidad</p>
      <div class="t-group">
        <div class="t-row" style="__ROW__"><span class="t-row-icon t-row-icon--accent">${IC.pin}</span><span class="t-row-copy"><strong>Ubicación</strong><small>Sólo entre el retiro y la entrega</small></span><span class="t-pill t-pill--ok"><i class="t-dot"></i>Activa</span></div>
        <button class="t-row" type="button"><span class="t-row-icon">${IC.store}</span><span class="t-row-copy"><strong>Qué compartimos</strong><small>Y durante cuánto tiempo</small></span><span></span>__CHEV__</button>
        <button class="t-row" type="button"><span class="t-row-icon">${IC.box}</span><span class="t-row-copy"><strong>Telemetría de uso</strong><small>Podés desactivarla</small></span><span class="t-row-value">Activada</span>__CHEV__</button>
      </div>
      <p class="t-group-label">Equipo</p>
      <div class="t-group">
        <div class="t-row" style="__ROW__"><span class="t-row-icon">${IC.net}</span><span class="t-row-copy"><strong>Acciones pendientes</strong><small>Todo sincronizado</small></span><span class="t-pill t-pill--ok"><i class="t-dot"></i>0</span></div>
        <button class="t-row" type="button"><span class="t-row-icon">${IC.batt}</span><span class="t-row-copy"><strong>Ahorro de batería</strong><small>Puede detener el seguimiento</small></span><span class="t-row-value">Revisar</span>__CHEV__</button>
        <button class="t-row" type="button"><span class="t-row-icon">${IC.box}</span><span class="t-row-copy"><strong>Enviar diagnóstico</strong><small>Registro sin datos personales</small></span><span></span>__CHEV__</button>
      </div>
      <button class="t-btn t-btn--danger t-btn--block" type="button" data-go="login">Cerrar sesión</button>
      <p class="t-caption">Si cerrás sesión con acciones pendientes, te avisamos antes de salir.</p>
    </div>`,
    actions:`<button class="t-btn t-btn--secondary t-btn--lg t-btn--block" type="button" data-go="home">Volver al turno</button>`
  },
"""

nuevas = nuevas.replace('__CHEV__', CHEV).replace('__ROW__', ROW)

anchor = '\n};\n\nlet current = "home";'
assert anchor in s, 'no se encontró el cierre de SCREENS'
s = s.replace(anchor, nuevas + '};\n\nlet current = "home";')

# Iconos que faltaban en el diccionario IC
old_ic = "  nav:'<svg width=\"18\" height=\"18\""
assert old_ic in s
add_ic = """  net:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 18h2v-3H4zM9 18h2v-6H9zM14 18h2v-9h-2zM19 18h2V6h-2z" fill="currentColor"/></svg>',
  batt:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="15" height="8" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M20 11v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="10" width="8" height="4" fill="currentColor"/></svg>',
"""
s = s.replace(old_ic, add_ic + old_ic)

# Botones en la barra de demostración
old_bar = '  <button data-screen="shiftend">Fin de turno</button>'
assert old_bar in s
new_bar = old_bar + """
  <button data-screen="expired">Sesión expirada</button>
  <button data-screen="cancelled">Cancelado</button>
  <button data-screen="absent">Cliente ausente</button>
  <button data-screen="history">Historial</button>
  <button data-screen="settings">Perfil</button>"""
s = s.replace(old_bar, new_bar)

# Accesos desde pantallas existentes
s = s.replace('<button class="t-row" type="button"><span class="t-row-icon">${IC.box}</span><span class="t-row-copy"><strong>Entregas de hoy</strong><small>6 completadas · 0 incidencias</small></span>',
              '<button class="t-row" type="button" data-go="history"><span class="t-row-icon">${IC.box}</span><span class="t-row-copy"><strong>Entregas de hoy</strong><small>6 completadas · 1 incidencia</small></span>')
s = s.replace('<div class="r-sec"><button class="t-btn t-btn--secondary" type="button" data-go="shiftend">Terminar turno</button></div>',
              '<div class="r-sec"><button class="t-btn t-btn--secondary" type="button" data-go="settings">Perfil</button><button class="t-btn t-btn--secondary" type="button" data-go="shiftend">Terminar turno</button></div>')
s = s.replace('<button class="t-btn t-btn--danger" type="button" data-go="incident">Cliente ausente</button>',
              '<button class="t-btn t-btn--danger" type="button" data-go="absent">Cliente ausente</button>')

io.open(p, 'w', encoding='utf-8').write(s)
print('ok · 5 pantallas nuevas del rider')
