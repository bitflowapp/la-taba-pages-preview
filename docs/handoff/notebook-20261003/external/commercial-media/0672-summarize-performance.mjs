import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve('artifacts/taba2-commercial/before/performance');
const files = await readdir(directory);
const lighthouseFiles = files
  .filter((name) => /^lighthouse-(320|390)-run\d+\.json$/.test(name))
  .sort();
const firstProductFiles = files
  .filter((name) => /^first-product-(320|390)-run\d+\.json$/.test(name))
  .sort();

const lighthouseRuns = await Promise.all(lighthouseFiles.map(async (name) => {
  const report = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
  const match = name.match(/^lighthouse-(\d+)-run(\d+)\.json$/);
  const resource = Object.fromEntries(
    (report.audits['resource-summary']?.details?.items || []).map((item) => [item.resourceType, item]),
  );
  const mainThread = Object.fromEntries(
    (report.audits['mainthread-work-breakdown']?.details?.items || []).map((item) => [item.group, item.duration]),
  );
  const lcpTable = report.audits['lcp-breakdown-insight']?.details?.items
    ?.find((item) => item.type === 'table');
  const lcpNode = report.audits['lcp-breakdown-insight']?.details?.items
    ?.find((item) => item.type === 'node');
  return {
    file: name,
    width: Number(match[1]),
    run: Number(match[2]),
    report,
    row: {
      viewportWidth: Number(match[1]),
      run: Number(match[2]),
      fetchTime: report.fetchTime,
      performanceScore: report.categories.performance.score * 100,
      fcpMs: report.audits['first-contentful-paint'].numericValue,
      lcpMs: report.audits['largest-contentful-paint'].numericValue,
      cls: report.audits['cumulative-layout-shift'].numericValue,
      tbtMs: report.audits['total-blocking-time'].numericValue,
      speedIndexMs: report.audits['speed-index'].numericValue,
      interactiveMs: report.audits.interactive.numericValue,
      totalRequests: resource.total?.requestCount || 0,
      totalTransferBytes: resource.total?.transferSize || 0,
      jsRequests: resource.script?.requestCount || 0,
      jsTransferBytes: resource.script?.transferSize || 0,
      imageRequests: resource.image?.requestCount || 0,
      imageTransferBytes: resource.image?.transferSize || 0,
      stylesheetRequests: resource.stylesheet?.requestCount || 0,
      stylesheetTransferBytes: resource.stylesheet?.transferSize || 0,
      thirdPartyRequests: resource['third-party']?.requestCount || 0,
      thirdPartyTransferBytes: resource['third-party']?.transferSize || 0,
      jsExecutionParseMs: report.audits['bootup-time'].numericValue,
      mainThreadWorkMs: report.audits['mainthread-work-breakdown'].numericValue,
      mainThreadScriptEvaluationMs: mainThread.scriptEvaluation || 0,
      mainThreadScriptParseCompileMs: mainThread.scriptParseCompile || 0,
      mainThreadStyleLayoutMs: mainThread.styleLayout || 0,
      renderBlockingFcpSavingsMs: report.audits['render-blocking-insight']?.metricSavings?.FCP || 0,
      unusedJsSavingsBytes: report.audits['unused-javascript']?.details?.overallSavingsBytes || 0,
      unusedJsLcpSavingsMs: report.audits['unused-javascript']?.metricSavings?.LCP
        || report.audits['unused-javascript']?.details?.debugData?.metricSavings?.LCP
        || 0,
      imageSavingsBytes: report.audits['image-delivery-insight']?.details?.debugData?.wastedBytes || 0,
      lcpTtfbMs: lcpTable?.items?.find((item) => item.subpart === 'timeToFirstByte')?.duration || 0,
      lcpResourceLoadDelayMs: lcpTable?.items?.find((item) => item.subpart === 'resourceLoadDelay')?.duration || 0,
      lcpResourceLoadDurationMs: lcpTable?.items?.find((item) => item.subpart === 'resourceLoadDuration')?.duration || 0,
      lcpElementRenderDelayMs: lcpTable?.items?.find((item) => item.subpart === 'elementRenderDelay')?.duration || 0,
      lcpElement: lcpNode?.nodeLabel || lcpNode?.selector || null,
      runWarningCount: report.runWarnings?.length || 0,
      runtimeErrorCode: report.runtimeError?.code || null,
    },
  };
}));

const firstProductRuns = await Promise.all(firstProductFiles.map(async (name) => {
  const report = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
  return {
    file: name,
    report,
    row: {
      viewportWidth: report.viewport.width,
      run: report.run,
      measuredAt: report.measuredAt,
      renderedMs: report.firstPurchasableRenderedMs,
      fullyInViewportMs: report.firstPurchasableFullyInViewportMs,
      initialNavigations: report.interactionSteps.initialNavigations,
      taps: report.interactionSteps.taps,
      scrollGestures: report.interactionSteps.scrollGestures,
      requestCount: report.networkSummary.requestCount,
      failedRequestCount: report.networkSummary.failedRequestCount,
      transferBytes: report.networkSummary.transferBytes,
    },
  };
}));

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianRows(rows, ignoredKeys = []) {
  const result = {};
  for (const key of Object.keys(rows[0] || {})) {
    if (ignoredKeys.includes(key)) continue;
    const values = rows.map((row) => row[key]);
    if (values.every((value) => typeof value === 'number')) result[key] = median(values);
  }
  return result;
}

function medianDetails(runs, auditId, valueKeys) {
  const byUrl = new Map();
  for (const run of runs) {
    for (const item of run.report.audits[auditId]?.details?.items || []) {
      if (!item.url) continue;
      const entry = byUrl.get(item.url) || {};
      for (const key of valueKeys) {
        (entry[key] ||= []).push(item[key] || 0);
      }
      byUrl.set(item.url, entry);
    }
  }
  return [...byUrl.entries()].map(([url, values]) => ({
    url,
    ...Object.fromEntries(valueKeys.map((key) => [key, median(values[key] || [])])),
  }));
}

function medianNetworkRequests(runs) {
  return medianDetails(runs, 'network-requests', ['transferSize', 'resourceSize']);
}

const profileSummaries = {};
for (const width of [390, 320]) {
  const runs = lighthouseRuns.filter((run) => run.width === width);
  const fpRuns = firstProductRuns.filter((run) => run.report.viewport.width === width);
  profileSummaries[width] = {
    lighthouseRunCount: runs.length,
    lighthouseMedian: medianRows(runs.map((run) => run.row), [
      'viewportWidth', 'run', 'runWarningCount', 'runtimeErrorCode', 'lcpElement',
    ]),
    firstProductRunCount: fpRuns.length,
    firstProductMedian: medianRows(fpRuns.map((run) => run.row), [
      'viewportWidth', 'run', 'initialNavigations', 'taps', 'scrollGestures', 'failedRequestCount',
    ]),
    firstProductInteractionSteps: {
      initialNavigations: 1,
      taps: 0,
      scrollGesturesMedian: median(fpRuns.map((run) => run.row.scrollGestures)),
    },
  };
}

const runs390 = lighthouseRuns.filter((run) => run.width === 390);
const medianNetwork390 = medianNetworkRequests(runs390);
const externalMapLibre = medianNetwork390
  .filter((item) => /unpkg\.com\/maplibre-gl@/i.test(item.url))
  .sort((a, b) => b.transferSize - a.transferSize);
const internalMapModules = medianNetwork390
  .filter((item) => {
    const parsed = new URL(item.url);
    return parsed.hostname === 'taba2-staging.pages.dev'
      && (/\/js\/map\//.test(parsed.pathname)
        || /\/js\/sandbox\/sandbox_map_scenario\.js$/.test(parsed.pathname));
  })
  .sort((a, b) => b.transferSize - a.transferSize);
const observedMapRuntimeAssets = medianNetwork390.filter((item) => {
  if (/unpkg\.com\/maplibre-gl@/i.test(item.url)) return false;
  const parsed = new URL(item.url);
  return /\.(pbf|mvt)(\?|$)/i.test(parsed.pathname)
    || /\/(tiles?|glyphs?|sprites?)\//i.test(parsed.pathname)
    || /(?:openfreemap|maptiler|mapbox)/i.test(parsed.hostname)
    || /style\.json$/i.test(parsed.pathname);
});

const mapLibreRenderBlocker = medianDetails(runs390, 'render-blocking-insight', ['totalBytes', 'wastedMs'])
  .find((item) => /unpkg\.com\/maplibre-gl@.*\.css/i.test(item.url));
const trackingCssRenderBlocker = medianDetails(runs390, 'render-blocking-insight', ['totalBytes', 'wastedMs'])
  .find((item) => /\/styles\/tracking\.css/i.test(item.url));

const topTransfers = medianNetwork390
  .sort((a, b) => b.transferSize - a.transferSize)
  .slice(0, 15);
const topCpu = medianDetails(runs390, 'bootup-time', ['total', 'scripting', 'scriptParseCompile'])
  .sort((a, b) => b.total - a.total)
  .slice(0, 10);
const unusedJavaScript = medianDetails(runs390, 'unused-javascript', ['totalBytes', 'wastedBytes', 'wastedPercent'])
  .sort((a, b) => b.wastedBytes - a.wastedBytes);
const imageDelivery = medianDetails(runs390, 'image-delivery-insight', ['totalBytes', 'wastedBytes'])
  .sort((a, b) => b.wastedBytes - a.wastedBytes);
const renderBlockers = medianDetails(runs390, 'render-blocking-insight', ['totalBytes', 'wastedMs'])
  .sort((a, b) => b.wastedMs - a.wastedMs);

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: {
    target: 'https://taba2-staging.pages.dev/',
    customerStorefrontOnly: true,
    excluded: ['tracking', 'map UI', 'GPS', 'Follow/Seguir', 'Explore'],
    interactionsPerformedByPerformanceRuns: 'None except deterministic scroll-to-first-product in the custom timing probe.',
  },
  environment: {
    lighthouseVersion: lighthouseRuns[0]?.report.lighthouseVersion,
    chromeProductVersion: '151.0.7922.108',
    lighthouseUserAgent: lighthouseRuns[0]?.report.userAgent,
    nodeVersion: process.version,
    os: lighthouseRuns[0]?.report.environment?.hostUserAgent || 'Windows 11',
  },
  lighthouseConfiguration: lighthouseRuns[0]?.report.configSettings,
  validation: {
    lighthouseReportCount: lighthouseRuns.length,
    firstProductReportCount: firstProductRuns.length,
    lighthouseReportsWithRunWarnings: lighthouseRuns.filter((run) => run.row.runWarningCount > 0).length,
    lighthouseReportsWithRuntimeErrors: lighthouseRuns.filter((run) => run.row.runtimeErrorCode).length,
    requestedUrls: [...new Set(lighthouseRuns.map((run) => run.report.requestedUrl))],
    finalUrls: [...new Set(lighthouseRuns.map((run) => run.report.finalDisplayedUrl))],
  },
  profiles: profileSummaries,
  customerHomeMapEvidence390: {
    zeroInteractions: true,
    externalMapLibreRequestCount: externalMapLibre.length,
    externalMapLibreTransferBytes: externalMapLibre.reduce((sum, item) => sum + item.transferSize, 0),
    externalMapLibre,
    internalMapModuleRequestCount: internalMapModules.length,
    internalMapModuleTransferBytes: internalMapModules.reduce((sum, item) => sum + item.transferSize, 0),
    internalMapModules,
    combinedMapRelatedRequestCount: externalMapLibre.length + internalMapModules.length,
    combinedMapRelatedTransferBytes: [...externalMapLibre, ...internalMapModules]
      .reduce((sum, item) => sum + item.transferSize, 0),
    mapLibreCssRenderBlocker: mapLibreRenderBlocker,
    trackingCssRenderBlocker,
    observedTileStyleGlyphSpriteFontRequestCount: observedMapRuntimeAssets.length,
    observedTileStyleGlyphSpriteFontRequests: observedMapRuntimeAssets,
    note: 'MapLibre CSS/JS and first-party map modules load on `/`; no map was opened or instantiated, so no tiles/style/glyph/sprite/font payloads were fetched.',
  },
  majorOffenders390: {
    topTransfers,
    topCpu,
    unusedJavaScript,
    imageDelivery,
    renderBlockers,
  },
  rawLighthouseRuns: lighthouseRuns.map((run) => run.row),
  rawFirstProductRuns: firstProductRuns.map((run) => run.row),
  caveats: [
    'Lighthouse is a lab simulation, not field Core Web Vitals; navigation-only runs do not produce field INP, so TBT is reported as the interaction-responsiveness proxy.',
    'Lighthouse simulated Slow 4G uses 150 ms RTT, 1,638.4 Kbps throughput, and 4x CPU. The custom first-product probe uses the matching DevTools applied values: 562.5 ms request latency, 1,474.56 Kbps download, 675 Kbps upload, and 4x CPU.',
    'The custom first-product probe blocks service workers and disables cache to make a repeatable cold-start measurement; production repeat visits may be faster.',
    'LCP is variable and bimodal in this sample, so medians are the comparison baseline and all raw runs are retained.',
    'Lighthouse durations attached to individual render-blocking requests overlap and must not be summed.',
    'The first 390 Lighthouse report was successfully written and has no run warning/runtime error, but its CLI process returned a Windows EPERM while cleaning its temporary Chrome profile; later runs used per-run TEMP directories and exited 0.',
  ],
};

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const keys = Object.keys(rows[0] || {});
  return [keys.join(','), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(','))].join('\n') + '\n';
}

function ms(value) {
  return `${Math.round(value)} ms`;
}

function seconds(value) {
  return `${(value / 1000).toFixed(2)} s`;
}

function kib(value) {
  return `${(value / 1024).toFixed(1)} KiB`;
}

const p390 = summary.profiles[390];
const p320 = summary.profiles[320];
const reportMarkdown = `# TABA2 customer storefront — BEFORE performance baseline

Measured ${summary.generatedAt} against \`${summary.scope.target}\`. Scope was customer home only; tracking, map UI, GPS, Seguir/Follow, and Explore were never entered.

## Median mobile results

| Metric | 390 × 844 (5 runs) | 320 × 568 (3 runs) |
| --- | ---: | ---: |
| Lighthouse performance score | ${Math.round(p390.lighthouseMedian.performanceScore)} | ${Math.round(p320.lighthouseMedian.performanceScore)} |
| FCP | ${seconds(p390.lighthouseMedian.fcpMs)} | ${seconds(p320.lighthouseMedian.fcpMs)} |
| LCP | ${seconds(p390.lighthouseMedian.lcpMs)} | ${seconds(p320.lighthouseMedian.lcpMs)} |
| CLS | ${p390.lighthouseMedian.cls.toFixed(4)} | ${p320.lighthouseMedian.cls.toFixed(4)} |
| TBT (lab INP proxy) | ${ms(p390.lighthouseMedian.tbtMs)} | ${ms(p320.lighthouseMedian.tbtMs)} |
| Speed Index | ${seconds(p390.lighthouseMedian.speedIndexMs)} | ${seconds(p320.lighthouseMedian.speedIndexMs)} |
| Time to Interactive | ${seconds(p390.lighthouseMedian.interactiveMs)} | ${seconds(p320.lighthouseMedian.interactiveMs)} |
| JS transfer | ${kib(p390.lighthouseMedian.jsTransferBytes)} / ${p390.lighthouseMedian.jsRequests} requests | ${kib(p320.lighthouseMedian.jsTransferBytes)} / ${p320.lighthouseMedian.jsRequests} requests |
| JS execution + parse | ${ms(p390.lighthouseMedian.jsExecutionParseMs)} | ${ms(p320.lighthouseMedian.jsExecutionParseMs)} |
| Main-thread work | ${seconds(p390.lighthouseMedian.mainThreadWorkMs)} | ${seconds(p320.lighthouseMedian.mainThreadWorkMs)} |
| Image transfer | ${kib(p390.lighthouseMedian.imageTransferBytes)} / ${p390.lighthouseMedian.imageRequests} requests | ${kib(p320.lighthouseMedian.imageTransferBytes)} / ${p320.lighthouseMedian.imageRequests} requests |
| Total home transfer | ${kib(p390.lighthouseMedian.totalTransferBytes)} / ${p390.lighthouseMedian.totalRequests} requests | ${kib(p320.lighthouseMedian.totalTransferBytes)} / ${p320.lighthouseMedian.totalRequests} requests |
| Render-blocking estimated FCP savings | ${seconds(p390.lighthouseMedian.renderBlockingFcpSavingsMs)} | ${seconds(p320.lighthouseMedian.renderBlockingFcpSavingsMs)} |
| Unused JS estimated savings | ${kib(p390.lighthouseMedian.unusedJsSavingsBytes)} | ${kib(p320.lighthouseMedian.unusedJsSavingsBytes)} |
| Responsive image estimated savings | ${kib(p390.lighthouseMedian.imageSavingsBytes)} | ${kib(p320.lighthouseMedian.imageSavingsBytes)} |

## First purchasable product

Definition: first enabled, laid-out product “Agregar” button; reachable means the button is fully inside the viewport. The initial URL navigation is counted separately from interaction steps.

| Viewport | Rendered median | Fully in viewport median | Steps after navigation |
| --- | ---: | ---: | --- |
| 390 × 844 | ${seconds(p390.firstProductMedian.renderedMs)} | ${seconds(p390.firstProductMedian.fullyInViewportMs)} | 0 taps, ${p390.firstProductInteractionSteps.scrollGesturesMedian} scrolls |
| 320 × 568 | ${seconds(p320.firstProductMedian.renderedMs)} | ${seconds(p320.firstProductMedian.fullyInViewportMs)} | 0 taps, ${p320.firstProductInteractionSteps.scrollGesturesMedian} scroll |

The 390 px probe observed a median ${p390.firstProductMedian.requestCount} customer-home requests / ${kib(p390.firstProductMedian.transferBytes)} transferred under applied Slow 4G and 4× CPU. Lighthouse reports ${p390.lighthouseMedian.totalRequests} requests / ${kib(p390.lighthouseMedian.totalTransferBytes)} under its simulated model; the small count/byte difference is instrumentation-specific.

## Main offenders at 390 px

- LCP median is ${seconds(p390.lighthouseMedian.lcpMs)} and varied from ${seconds(Math.min(...runs390.map((run) => run.row.lcpMs)))} to ${seconds(Math.max(...runs390.map((run) => run.row.lcpMs)))}. The reported LCP element is the home hero promo media; median modeled element render delay is ${seconds(p390.lighthouseMedian.lcpElementRenderDelayMs)}.
- ${p390.lighthouseMedian.jsRequests} script requests transfer ${kib(p390.lighthouseMedian.jsTransferBytes)}. Lighthouse estimates ${kib(p390.lighthouseMedian.unusedJsSavingsBytes)} unused JS, led by MapLibre (${kib(unusedJavaScript[0]?.wastedBytes || 0)}), Supabase client (${kib(unusedJavaScript[1]?.wastedBytes || 0)}), and the Supabase order repository (${kib(unusedJavaScript[2]?.wastedBytes || 0)}).
- MapLibre loads on customer home without entering tracking: ${summary.customerHomeMapEvidence390.externalMapLibreRequestCount} external requests / ${kib(summary.customerHomeMapEvidence390.externalMapLibreTransferBytes)}, plus ${summary.customerHomeMapEvidence390.internalMapModuleRequestCount} first-party map JS modules / ${kib(summary.customerHomeMapEvidence390.internalMapModuleTransferBytes)}. Its CSS is render-blocking with median ${ms(summary.customerHomeMapEvidence390.mapLibreCssRenderBlocker.wastedMs)} critical duration. No tiles, map style, glyphs, sprites, or fonts were requested.
- Images transfer ${kib(p390.lighthouseMedian.imageTransferBytes)} and Lighthouse estimates ${kib(p390.lighthouseMedian.imageSavingsBytes)} avoidable bytes. The top four flagged product images are 1000×1000 files rendered around 116×116.
- All 15 stylesheets are render-blocking; modeled FCP savings median is ${seconds(p390.lighthouseMedian.renderBlockingFcpSavingsMs)}. These include MapLibre CSS and \`tracking.css\` even on untouched customer home.

## Exact tooling and commands

- Node ${process.version}; Lighthouse ${summary.environment.lighthouseVersion}; Chrome ${summary.environment.chromeProductVersion} (Lighthouse UA: Chrome 151 headless).
- Install used: \`npm.cmd install --prefix C:\\Users\\marco\\AppData\\Local\\Temp\\taba2-perf-lighthouse-13.4.1 --no-audit --no-fund --ignore-scripts lighthouse@13.4.1\`.
- Lighthouse runs: \`powershell -ExecutionPolicy Bypass -File .\\run-lighthouse.ps1\` from this directory. The script records the complete flags: performance-only, mobile, 390×844 (5) and 320×568 (3), DPR 3, simulated Slow 4G, fresh Chrome profile, Chrome 151.
- First-product/CDP runs: \`node .\\measure-first-product.mjs\` from this directory. Configuration is embedded in each raw report: cache disabled, service workers blocked, 562.5 ms request latency, 1,474.56 Kbps download, 675 Kbps upload, 4× CPU.
- Summary regeneration: \`node .\\summarize-performance.mjs\`.

## Caveats

${summary.caveats.map((item) => `- ${item}`).join('\n')}
`;

await Promise.all([
  writeFile(path.join(directory, 'performance-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
  writeFile(path.join(directory, 'lighthouse-runs.csv'), toCsv(lighthouseRuns.map((run) => run.row)), 'utf8'),
  writeFile(path.join(directory, 'first-product-runs.csv'), toCsv(firstProductRuns.map((run) => run.row)), 'utf8'),
  writeFile(path.join(directory, 'README.md'), reportMarkdown, 'utf8'),
]);

console.log(JSON.stringify({
  reports: lighthouseRuns.length,
  firstProductReports: firstProductRuns.length,
  median390: profileSummaries[390],
  median320: profileSummaries[320],
  mapEvidence: summary.customerHomeMapEvidence390,
}, null, 2));
