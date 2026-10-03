# TABA2 customer storefront — BEFORE performance baseline

Measured 2026-08-11T07:07:01.037Z against `https://taba2-staging.pages.dev/`. Scope was customer home only; tracking, map UI, GPS, Seguir/Follow, and Explore were never entered.

## Median mobile results

| Metric | 390 × 844 (5 runs) | 320 × 568 (3 runs) |
| --- | ---: | ---: |
| Lighthouse performance score | 70 | 70 |
| FCP | 2.67 s | 2.63 s |
| LCP | 9.38 s | 9.32 s |
| CLS | 0.0136 | 0.0195 |
| TBT (lab INP proxy) | 97 ms | 79 ms |
| Speed Index | 3.59 s | 3.37 s |
| Time to Interactive | 10.14 s | 10.08 s |
| JS transfer | 718.7 KiB / 92 requests | 718.8 KiB / 92 requests |
| JS execution + parse | 340 ms | 340 ms |
| Main-thread work | 1.32 s | 1.40 s |
| Image transfer | 211.8 KiB / 9 requests | 211.8 KiB / 9 requests |
| Total home transfer | 1073.8 KiB / 137 requests | 1074.0 KiB / 137 requests |
| Render-blocking estimated FCP savings | 1.30 s | 1.30 s |
| Unused JS estimated savings | 286.4 KiB | 286.5 KiB |
| Responsive image estimated savings | 167.3 KiB | 167.9 KiB |

## First purchasable product

Definition: first enabled, laid-out product “Agregar” button; reachable means the button is fully inside the viewport. The initial URL navigation is counted separately from interaction steps.

| Viewport | Rendered median | Fully in viewport median | Steps after navigation |
| --- | ---: | ---: | --- |
| 390 × 844 | 7.97 s | 8.02 s | 0 taps, 0 scrolls |
| 320 × 568 | 7.92 s | 8.13 s | 0 taps, 1 scroll |

The 390 px probe observed a median 136 customer-home requests / 1072.6 KiB transferred under applied Slow 4G and 4× CPU. Lighthouse reports 137 requests / 1073.8 KiB under its simulated model; the small count/byte difference is instrumentation-specific.

## Main offenders at 390 px

- LCP median is 9.38 s and varied from 6.97 s to 10.42 s. The reported LCP element is the home hero promo media; median modeled element render delay is 1.19 s.
- 92 script requests transfer 718.7 KiB. Lighthouse estimates 286.4 KiB unused JS, led by MapLibre (226.6 KiB), Supabase client (38.0 KiB), and the Supabase order repository (21.7 KiB).
- MapLibre loads on customer home without entering tracking: 2 external requests / 280.0 KiB, plus 10 first-party map JS modules / 41.1 KiB. Its CSS is render-blocking with median 977 ms critical duration. No tiles, map style, glyphs, sprites, or fonts were requested.
- Images transfer 211.8 KiB and Lighthouse estimates 167.3 KiB avoidable bytes. The top four flagged product images are 1000×1000 files rendered around 116×116.
- All 15 stylesheets are render-blocking; modeled FCP savings median is 1.30 s. These include MapLibre CSS and `tracking.css` even on untouched customer home.

## Exact tooling and commands

- Node v24.8.0; Lighthouse 13.4.1; Chrome 151.0.7922.108 (Lighthouse UA: Chrome 151 headless).
- Install used: `npm.cmd install --prefix C:\Users\marco\AppData\Local\Temp\taba2-perf-lighthouse-13.4.1 --no-audit --no-fund --ignore-scripts lighthouse@13.4.1`.
- Lighthouse runs: `powershell -ExecutionPolicy Bypass -File .\run-lighthouse.ps1` from this directory. The script records the complete flags: performance-only, mobile, 390×844 (5) and 320×568 (3), DPR 3, simulated Slow 4G, fresh Chrome profile, Chrome 151.
- First-product/CDP runs: `node .\measure-first-product.mjs` from this directory. Configuration is embedded in each raw report: cache disabled, service workers blocked, 562.5 ms request latency, 1,474.56 Kbps download, 675 Kbps upload, 4× CPU.
- Summary regeneration: `node .\summarize-performance.mjs`.

## Caveats

- Lighthouse is a lab simulation, not field Core Web Vitals; navigation-only runs do not produce field INP, so TBT is reported as the interaction-responsiveness proxy.
- Lighthouse simulated Slow 4G uses 150 ms RTT, 1,638.4 Kbps throughput, and 4x CPU. The custom first-product probe uses the matching DevTools applied values: 562.5 ms request latency, 1,474.56 Kbps download, 675 Kbps upload, and 4x CPU.
- The custom first-product probe blocks service workers and disables cache to make a repeatable cold-start measurement; production repeat visits may be faster.
- LCP is variable and bimodal in this sample, so medians are the comparison baseline and all raw runs are retained.
- Lighthouse durations attached to individual render-blocking requests overlap and must not be summed.
- The first 390 Lighthouse report was successfully written and has no run warning/runtime error, but its CLI process returned a Windows EPERM while cleaning its temporary Chrome profile; later runs used per-run TEMP directories and exited 0.
