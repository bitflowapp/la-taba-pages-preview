# Moto physical test plan — Task06

## Preconditions

- Moto unlocked and on a real route with Location services enabled.
- Staging rider account with an assigned controlled delivery.
- Staging Gate2 migration confirmed applied.
- APK produced from the tested Task06 worktree.
- Test operator can inspect only sanitized app state and approved staging evidence.

## Execute

1. Grant precise location and notifications. Confirm approximate-only permission blocks operational start.
2. Start delivery from the visible app. Confirm notification appears immediately and state moves starting to fresh after a real server ACK.
3. Lock the screen for at least 10 minutes while moving. Confirm new server sequence values and no Flutter screen requirement.
4. Open another app and repeat the moving check.
5. Disable network for 2–5 minutes. Confirm delayed/queued state, bounded queue and no crash. Restore network and confirm fresh after drain.
6. Turn Location off. Confirm no_signal or sanitized actionable error, never fresh.
7. Pause from the notification. Confirm technical tracking stops and the backend order is not claimed as completed/cancelled.
8. Expire/revoke the session in the controlled staging scenario. Confirm one refresh and then sanitized recoverable error, with no token/body visible.
9. Capture battery level, Android version, APK hash, timestamps and server sequence only. Redact coordinates, addresses, order IDs, credentials and HTTP bodies.

## Pass criteria

- At least one real location is accepted by staging and returns a new sequence.
- Freshness status reflects server ACK age.
- Screen lock, another app and short offline recovery work without Dart activity.
- No sensitive field appears in logcat, bridge events or evidence.

## Out of scope

Reboot, force-stop, durable queue and full process-death recovery are Task07/08 certification gates. Do not label them PASS for Task06.
