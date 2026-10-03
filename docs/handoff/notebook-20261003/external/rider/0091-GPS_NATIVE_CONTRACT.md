# GPS native contract — Task06

## Ownership

RiderForegroundService owns FusedLocationProviderClient, validation, queue and uploader. Flutter can start, stop, read a sanitized snapshot and observe sanitized events. Flutter does not receive GPS samples or native credentials.

## Gate2 publication

The only publication is public.publish_rider_location with:

1. p_order_id
2. p_expected_revision
3. p_lat
4. p_lng
5. p_accuracy
6. p_heading
7. p_speed
8. p_captured_at

No idempotency key, batch body, endpoint or RPC was added. The server remains authoritative for sequence and recorded_at.

## Local policy

| Item | Policy |
|---|---|
| Permission | ACCESS_FINE_LOCATION required; COARSE blocked. |
| Foreground type | location; no ACCESS_BACKGROUND_LOCATION. |
| Active profile | HIGH_ACCURACY, 10 s desired interval, 5 s minimum, 10 m. |
| Quiet profile | BALANCED_POWER_ACCURACY, 30 s desired interval, 15 s minimum, 35 m. |
| Accuracy | finite and 0–250 m. |
| Coordinates | finite; latitude -90..90, longitude -180..180. |
| captured_at | device time, no more than 30 s future or 3 min old. |
| heading | null or finite in [0,360). |
| speed | null or finite in [0,70]. |
| Dedupe | rejects same/older captured_at and near-identical consecutive coordinates. |
| Server floor | waits at least 6 s after a successful publication. |
| Brief offline queue | max 32 in memory; max age 3 min; oldest drops on overflow. |

## Sanitized states

- starting
- fresh
- delayed
- stale
- no_signal
- error
- stopped

No bridge event contains a coordinate, token, HTTP body, SQLSTATE or internal order id.
