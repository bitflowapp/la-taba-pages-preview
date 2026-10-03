# Rider delivery contract — validation evidence

Date: 2026-08-02

## Source and commits

| Component | Worktree | Branch | Initial HEAD | Final HEAD |
|---|---|---|---|---|
| Backend | `C:\1212\la-taba-rider-server-contracts` | `feature/rider-delivery-server-contracts` | `c6d6a7b56df46fb6989b7e6584a165ff915de6c1` | `4960da279f0f668559ab55b6a751576b18232b95` |
| Rider | `D:\1212\la-taba-rider-live-contracts` | `feature/rider-live-contract-integration` | `db645b51f89c8862da6ad29af16ec4e194c9cbc6` | `f1f3f37c5e2793c40f672fbc9b099eee6a746dba` |

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| Backend `npm run check` | PASS | Release hygiene passed. |
| Backend `npm test` | PASS | 665 passed, 0 failed. |
| Migration static validation | PASS | 21 ordered migrations; informational policy-column notices only. |
| Contract focal suite | PASS | 8 passed, 0 failed. |
| Flutter analyze | PASS | 0 issues. |
| Flutter test | PASS | 61 passed, 0 failed. |
| JVM staging + production | PASS | 67 per variant; 134 total; 0 failed. |
| AndroidTest assembly staging + production | PASS | Both variants assembled. |
| Connected staging instrumentation | PASS | 10 tests, 0 failures, 0 errors, 0 skipped. |
| Sanitized logcat scan | PASS | 0 matching FATAL EXCEPTION, AndroidRuntime, ANR or FlutterError records. |

Gradle was invoked from its already-cached 9.1.0 distribution because this worktree does not contain the wrapper documented by the repository. No Gradle, AGP or Kotlin version was modified.

## APK and device smoke

| Field | Value |
|---|---|
| APK | `D:\1212\la-taba-rider-live-contracts\build\app\outputs\apk\staging\debug\app-staging-debug.apk` |
| Package | `com.lataba.rider.staging` |
| Flavor | staging / debug |
| versionName / versionCode | 1.0 / 1 |
| SHA-256 | `D7419C3761FD8335B4C33F1BCC2C28F072E93F77A7003F189464BA3AC6B1073A` |
| Rider HEAD | `f1f3f37c5e2793c40f672fbc9b099eee6a746dba` |
| Install | PASS via `adb install -r`; staging only |
| Smoke | PASS: launch, HOME/return, force-stop/reopen, brief screen-off/on, process present |

No device serial, token, delivery code, personal address, phone, email or coordinate is retained here.

## Live staging

`LIVE_STAGING_TESTS_BLOCKED_BY_MISSING_CREDENTIALS`

The named staging variables were absent and no private local file supplied assignments for them. Therefore no project ref was verified, no migration was applied remotely, no synthetic order was created and no live actor claim/code/GPS flow was simulated.

## Physical scope

Automated installation, lifecycle smoke and instrumentation passed. Real rider login, motion GPS, Wi-Fi/data switching, airplane mode, denied/revoked permissions, battery optimization, background screen-off tracking and a physical code entry still require the guided checklist.

`DETAILED_PHYSICAL_VALIDATION_PENDING`
