export function clampSandboxProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

import { hasFreshSharedGpsLocation } from '../map/route_geometry.js';

export function sandboxTrackingPresentation(order = {}, simulation = null, { now = Date.now() } = {}) {
  const status = String(order?.status || '');
  // `origin` records how the rider last tried to share a location; it is not
  // proof that a location is currently available. In particular, a denied
  // browser permission keeps that provenance so the rider can retry, but must
  // never make the customer-facing UI say "Ubicación activa".
  const gpsStatus = String(simulation?.gpsStatus || 'inactive');
  const hasGpsFix = simulation?.source === 'gps'
    && ['active', 'last_fix'].includes(gpsStatus)
    && Number.isFinite(Number(simulation?.lat))
    && Number.isFinite(Number(simulation?.lng));
  const freshGpsFix = hasGpsFix && hasFreshSharedGpsLocation(simulation, { now });
  const gpsLive = freshGpsFix && gpsStatus === 'active' && !simulation?.gpsPaused;
  const gpsSnapshot = freshGpsFix && gpsStatus === 'last_fix';
  const gpsStale = hasGpsFix && !freshGpsFix;
  const gps = gpsLive || gpsSnapshot;
  const delivered = status === 'delivered';
  const userStarted = Boolean(simulation?.userStarted);
  const routeStarted = !gps && userStarted;
  const arrived = !delivered && (status === 'arriving' || (routeStarted && clampSandboxProgress(simulation?.progress) >= 1));
  const progress = arrived || delivered
    ? 100
    : routeStarted ? Math.round(clampSandboxProgress(simulation?.progress) * 100) : 0;
  const etaMinutes = routeStarted && Number.isFinite(Number(simulation?.etaMinutes))
    ? Math.max(0, Math.round(Number(simulation.etaMinutes)))
    : null;
  const running = Boolean(simulation?.running) && !arrived && !delivered;
  const paused = routeStarted && !running && !arrived && !delivered;
  const inTransit = !arrived && !delivered && (status === 'on_the_way' || progress > 0 || routeStarted || gps);

  const phaseLabel = delivered
    ? 'Entregado'
    : arrived
      ? 'Llegó al domicilio'
      : inTransit
        ? 'En camino'
        : status === 'ready'
          ? 'Listo para reparto'
          : 'Seguimiento por iniciar';
  const activityLabel = delivered
    ? 'Seguimiento finalizado'
    : arrived
      ? 'Llegó al domicilio'
    : gpsLive
        ? 'Ubicación activa'
    : gpsSnapshot
          ? 'Última ubicación disponible'
        : gpsStale
          ? 'Ubicación no disponible'
        : running
          ? 'Seguimiento activo'
          : paused
            ? 'Seguimiento pausado'
            : 'Seguimiento por iniciar';
  const etaLabel = delivered
    ? ''
    : arrived || etaMinutes === 0
      ? 'Llegó'
      : etaMinutes && etaMinutes > 0
        ? `${etaMinutes} min`
        : 'Al iniciar';

  return {
    source: gps ? 'local_gps' : 'sandbox_route',
    gps,
    gpsLive,
    gpsSnapshot,
    gpsStale,
    delivered,
    arrived,
    progress,
    etaMinutes,
    etaLabel,
    showEta: routeStarted && !delivered,
    running,
    paused,
    inTransit,
    phaseLabel,
    activityLabel,
    isActive: gpsLive || running,
    canStart: !gps && status === 'on_the_way' && !running && !arrived && !delivered,
    canPause: !gps && running,
    canReset: routeStarted && !arrived && !delivered && status === 'on_the_way',
  };
}
