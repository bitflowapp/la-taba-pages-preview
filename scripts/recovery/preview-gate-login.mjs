// Opens a session in the QA preview gate the way a reviewer does: its own login form at /__acceso (La Taba's QA
// page, never a third party), in a throw-away tab so the main page's console and network listeners only see the app.
// The session cookie stays in the browser context, so every page, and the service worker, carries it afterwards.
// Playwright only answers HTTP Basic challenges, and the gate answers a navigation with this form instead.
export async function passPreviewGate(context, origin, gate) {
  if (!gate?.usuario || !gate?.secreto) return false;
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/__acceso?volver=%2Fversion.json`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('#usuario').fill(gate.usuario);
    await page.locator('#clave').fill(gate.secreto);
    await Promise.all([
      page.waitForURL(url => !url.pathname.startsWith('/__acceso'), { timeout: 60000 }),
      page.locator('button[type="submit"]').click(),
    ]);
    const cookies = await context.cookies(origin);
    if (!cookies.some(cookie => cookie.name === '__Host-taba_qa' && cookie.httpOnly && cookie.secure)) {
      throw new Error('the preview gate did not open a session');
    }
    return true;
  } finally {
    await page.close();
  }
}
