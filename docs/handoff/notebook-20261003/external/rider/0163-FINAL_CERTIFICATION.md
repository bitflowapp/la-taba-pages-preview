# TABA2 Rider — final staging certification

## Scope and source control

- Authorized Supabase project only: `ukxqbgswjlibmnjemrzd` / `la-taba-staging`.
- SSL Enforcement: enabled and retained.
- Backend canonical source remained clean at `4960da279f0f668559ab55b6a751576b18232b95`.
- Android canonical source remained clean at `f1f3f37c5e2793c40f672fbc9b099eee6a746dba`.
- Backend correction branch: `fix/rider-staging-certification`, final `d0b995eaa642a8c78a28a0a9d966a3bdd89b6e7b`.
- No production access, push, PR, or Android source change.

## Remote contract

- PostgreSQL 17.6 over JIT TLS; Temporary Access was revoked in finally.
- Remote migrations: 21 before, 26 after; five Rider migration markers present.
- RPCs, RLS, grants, terminal trigger, legacy-route revocation, CAS, idempotency, rate limit, outbox, and terminal GPS closure verified remotely.
- Full synthetic multi-actor staging flow: PASS.

## Live flow result

Customer creation idempotency, business accepted/preparing/ready, concurrent claim, pickup, route start, GPS receipts, stale arrival reconciliation, incorrect code, double-tap idempotency, server rate limit, safe recovery, correct code, delivered transaction, unique event/outbox, terminal GPS rejection, active-delivery removal, and three-actor convergence all passed.

## Android and device result

- Flutter analyze: 0 issues.
- Flutter tests: 61/61 PASS.
- Gradle/JVM: 134 test cases, 0 failures/errors.
- AndroidTest assemblies: staging and production PASS.
- Moto G15 instrumentation: 10/10 PASS.
- APK staging debug: `com.lataba.rider.staging`, version 1.0.0 (1), SHA-256 `CA42E183E113E760A0A23D858407C7DAD3033DFCAB01339590C2FA72DC35886F`.
- `adb install -r`, launch, HOME/return, force-stop/reopen, and screen off/on: PASS.
- Final PID-scoped logcat: no FATAL EXCEPTION, ANR, FlutterError, or AndroidRuntime.

## Cleanup

All certification orders are terminal; active synthetic deliveries, GPS, locks, and Rider memberships are zero. Stock was restored, and terminal event/outbox audit records were deliberately retained. No human orders or memberships were changed.

## Remaining limits

Manual Moto G15 P0 scenarios are not inferred: real movement/GPS quality, explicit location and notification permission paths, Wi-Fi/data and airplane recovery, battery optimization, real notification interaction, physical code entry, and foreground-service stop after a physical route.

## Declarations

LA_TABA2_RIDER_FULL_STAGING_FLOW_CERTIFIED

DETAILED_PHYSICAL_VALIDATION_PENDING

`LA_TABA2_RIDER_ANDROID_READY_FOR_CONTROLLED_STAGING_PILOT` is not declared. `READY_FOR_PRODUCTION` is not used.
