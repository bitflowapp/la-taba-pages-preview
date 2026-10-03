# Moto G15 physical results

Automated device checks on exactly one authorized Moto G15:

- APK staging installed with `adb install -r`: PASS.
- Initial launch: PASS.
- HOME and return: PASS.
- Force-stop and reopen: PASS.
- Screen off/on and app still running: PASS.
- Instrumentation: PASS, 10/10.
- PID-scoped Rider logcat: PASS, no FATAL EXCEPTION, ANR, FlutterError, or AndroidRuntime signature.

Manual P0 validation remains `NOT_RUN`: QA login interaction, precise-location consent/denial/revocation, physical movement, background screen-off route, Wi-Fi-to-data transition, airplane-mode recovery, battery optimization, real notification/tap/deduplication, physical code entry, and foreground-service stop after a real route.

No local-data preservation claim is made because instrumentation may have changed package state before this certification run.
