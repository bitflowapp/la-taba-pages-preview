# Task06 security review

## Kept native

- Access and refresh tokens remain in SessionManager and EncryptedSessionStore.
- RiderRpcDataSource uses NativeRequestContext only in Kotlin.
- LocationPublisher uses the existing authenticated datasource; no token is copied to the in-memory queue.
- The queue contains only process-memory LocationSample values and disappears on stop/process death.

## Bridge and logging boundary

- Event/snapshot payloads do not include order_id, latitude, longitude, accuracy, heading, speed, JWT, refresh token, password, HTTP body or SQLSTATE.
- AuthError no longer serializes sqlState to Flutter.
- Delivery errors are stable keys such as gps_session_refresh_failed and gps_revision_conflict.
- No request/response logging was added.

## Authorization

- publish_rider_location is called with the current native authenticated session.
- A 401 refreshes once through SessionManager's existing single-flight mechanism.
- A second 401 pauses publication; it does not expose credentials or retry forever.
- Supabase RLS/RPC remains the authority. No service_role or AccessibilityService was added.

## Remaining constraints

- ActiveDeliveryStore is still the existing Task05 metadata store. Its encryption migration is Task07/08 work.
- Task06 in-memory queue is intentionally not durable; it cannot carry data across a killed process.
- A real staging/Moto test is required to validate permission/OEM behavior.

## 2026-08-02 certification-run artifact audit

- Current-run logcat was not exported because no current-run APK could be built or launched; this avoids collecting unrelated device data.
- Pattern scans across this artifact directory found no JWT-like value, bearer credential, token/password assignment, precise coordinate pair, complete UUID, or raw SQLSTATE value.
- The physical security audit remains pending a successful build, controlled Moto launch, and sanitized live log capture.
