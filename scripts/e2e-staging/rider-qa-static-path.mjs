/** Sólo archivos públicos del frontend. El servidor QA nunca expone otros árboles. */
export function riderQaStaticPath(pathname) {
  const relative = pathname === '/' ? 'index.html' : String(pathname || '').slice(1);
  if (relative.split('/').some((part) => part === '.' || part === '..')) return null;
  return /^(index\.html|(?:js|css|styles|assets|images|icons|fonts)\/[^?]+|[^/]+\.(?:js|css|svg|ico|webmanifest))$/.test(relative)
    ? relative : null;
}
