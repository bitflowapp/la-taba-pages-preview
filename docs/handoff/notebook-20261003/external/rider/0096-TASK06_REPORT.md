# LA TABA RIDER ANDROID — Task06 implementation report

Date: 2026-08-02  
Scope: Rider Android worktree only. Backend migration was read-only; Supabase, production, release signing and Git history were not modified.

## Implemented

- Added Google Play Services Location 21.4.0.
- RiderForegroundService promotes itself to a location foreground service before registering FusedLocationProviderClient updates.
- ACCESS_FINE_LOCATION is mandatory for operational tracking. COARSE no longer enables start. ACCESS_BACKGROUND_LOCATION was not added.
- Added native LocationSample, FusedLocationSource, adaptive LocationSampler and LocationQualityFilter.
- Added one serial LocationTrackingActor per active order and revision, with a bounded in-memory queue of 32 samples.
- Added validation for coordinate bounds, NaN/infinity, accuracy 0–250, captured_at window, heading, speed, mock-provider flag, dedupe, stale samples and a six-second local publication floor.
- Added exact Gate2 publication through RiderRpcDataSource and the existing native session/refresh path.
- HTTP 401 causes one existing SessionManager refresh/retry. A second 401 pauses publication and emits gps_session_refresh_failed as a recoverable, sanitized error.
- Added differentiated handling for Gate2 revision conflict, sanitized domain-conflict class, validation, 403, 429, network and 5xx outcomes.
- Delivery snapshots expose only status, public code, queue size, freshness age, error key and retryability. They no longer expose order_id. SQLSTATE is no longer serialized by AuthError to the Flutter bridge.
- Start service now receives the server-returned revision after start_rider_delivery, not the stale pre-transition revision.
- Notification action is labeled Pausar seguimiento and only stops technical tracking.

## Scope intentionally deferred to Task07/08

- The queue is process-memory only and is cleared on service stop. It is not persistent or encrypted.
- Full crash/reboot reconciliation and durable queue recovery remain Task07/08 gates.
- No physical GPS result is claimed.

## Required physical gate

Task06 is implemented for physical validation, not production approval. Moto evidence must confirm a real accepted staging sequence while locked, with another app open, after network loss/return, with Location disabled, and without Flutter active.

Veredicto: LA_TABA_RIDER_ANDROID_TASK06_IMPLEMENTATION_READY_FOR_PHYSICAL_TEST
