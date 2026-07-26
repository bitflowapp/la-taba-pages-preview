export function clampSandboxProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

export function sandboxTrackingPresentation(order = {}, simulation = null) {
  const status = String(order?.status || '');
  const gps = simulation?.origin === 'local_gps' || simulation?.source === 'gps' || simulation?.mode === 'gps';
  const delivered = status === 'delivered';
  const arrived = !delivered && (status === 'arriving' || clampSandboxProgress(simulation?.progress) >= 1);
  const progress = arrived || delivered ? 100 : Math.round(clampSandboxProgress(simulation?.progress) * 100);
  const etaMinutes = Number.isFinite(Number(simulation?.etaMinutes))
    ? Math.max(0, Math.round(Number(simulation.etaMinutes)))
    : null;
  const running = Boolean(simulation?.running) && !arrived && !delivered;
  const userStarted = Boolean(simulation?.userStarted);
  const paused = !gps && userStarted && !running && !arrived && !delivered;
  const inTransit = !arrived && !delivered && (status === 'on_the_way' || progress > 0 || userStarted);

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
      : gps
        ? 'Ubicación activa'
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
    delivered,
    arrived,
    progress,
    etaMinutes,
    etaLabel,
    showEta: !gps && !delivered,
    running,
    paused,
    inTransit,
    phaseLabel,
    activityLabel,
    isActive: gps || running,
    canStart: !gps && !running && !arrived && !delivered,
    canPause: !gps && running,
    canReset: !gps && !arrived && !delivered && status === 'on_the_way',
  };
}
