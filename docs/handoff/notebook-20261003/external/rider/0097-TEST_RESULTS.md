# Task06 test results

Date: 2026-08-02

| Check | Result | Evidence |
|---|---|---|
| flutter pub get | PASS | Dependencies resolved. |
| flutter analyze | PASS | No issues found. |
| flutter test | PASS | 33 tests passed. |
| git diff --check | PASS | No whitespace errors. |
| Gradle test | NOT COMPLETED | First attempt failed while unpacking Gradle because D temporary space was full. Retry using D cache exceeded runner timeout and later exited without an XML test report. |
| flutter build apk --debug | NOT COMPLETED | Runner timed out while Gradle work remained active; no new Task06 APK was verified. |
| Android instrumented | NOT EXECUTED | Requires a connected/unlocked device; Moto unavailable. |
| Physical GPS/staging | NOT EXECUTED | Moto gate remains mandatory. |

The two Android build rows are not PASS. They must be rerun after the current Gradle workers finish and the build environment is stable.

## Certification resumption (2026-08-02)

| Check | Result | Evidence |
| --- | --- | --- |
| flutter pub get | PASS | Completed in 2.47 s. |
| flutter analyze | PASS | No issues; completed in 57.56 s. |
| flutter test | PASS | 33 tests; completed in 21.93 s. |
| Gradle test --no-daemon | NOT COMPLETED | The first runner window ended at 64 s while Gradle compilation was starting. No test XML report was generated; the Rider daemon/wrapper were then stopped cleanly. |
| Debug APK | NOT RUN | Required Gradle test is incomplete. |

The Gradle diagnostic recorded deprecated Android/Kotlin-option warnings only before the runner window elapsed. It did not establish a Gradle test PASS or an APK PASS.

## Dedicated E: cache preflight (2026-08-02)

NOT STARTED: the requested Gradle rerun requires at least 10 GiB free on C: and active `TEMP`, `TMP`, `GRADLE_USER_HOME`, and `PUB_CACHE` values under `E:\\DevCache`. At preflight C: had 5.001 GiB free and all four active variables still pointed to D:. The Moto was connected; no Gradle process was started and no daemon from another project was stopped.

## Added automated coverage

- LocationQualityFilter: bounds, NaN/infinity, accuracy 0/250/>250, old/future time, heading/speed and mock flag.
- OfflineLocationQueue and QueueDrainWorker: dedupe, bounded queue, expiration, retry/backoff and six-second floor.
- LocationTrackingActor: native publish, stop protection, session pause and sanitized domain-conflict delay.
- ActiveDeliveryPolicy: second active order rejected.
- RiderRpcDataSource MockWebServer: exact Gate2 JSON, 2xx, 401 refresh/retry, sanitized revision/domain conflicts, validation 4xx, 429 and 5xx.
- Android instrumented source lifecycle, manifest permissions, snapshot redaction and stored revision recovery.


## Junction-build Gradle execution (2026-08-02)

| Check | Result | Evidence |
| --- | --- | --- |
| Gradle test --no-daemon --console=plain --stacktrace | FAIL | Natural completion after 312 seconds, exit 1. Android configuration reports missing compileSdk and then a Flutter-plugin NPE. |
| Debug APK | NOT RUN | Required Gradle test did not return BUILD SUCCESSFUL. |
| Moto installation | NOT RUN | No APK was produced/certified. |

This was not an ENOSPC or 60-second runner timeout. Git status and diff check matched the pre-build baseline after the failure.
