# LA TABA RIDER - Task 04 final evidence

Date: 2026-08-01 local execution; server timestamps are UTC. Scope was only
Supabase staging project `ukxqbgswjlibmnjemrzd` and the Android `staging`
flavor. No Android code was changed, and no commit, push, merge, deploy,
reset, restore, stash, or clean was used.

## QA identities

- Two independent Auth users were used with separate sessions and tokens.
- Rider 2 was provisioned in the QA business with active role `rider`.
- The credential file exists at the requested path with exclusive current-user
  ACL. Passwords, tokens, user IDs, Authorization headers, and service_role
  values are not present in this report.
- Both real logins passed; the final comparison confirmed rider 1 and rider 2
  are different users.

## Definitive real race

Target: synthetic `staging_only` catalog order `LT-0011`, order ID
`8befb9ab-459b-46a9-a333-c8029005394a`.

Before the race it was created through the customer RPC and moved through the
business state machine `received -> accepted -> preparing -> ready`, with
revision 6, delivery mode `delivery`, ARS product price 400, and no rider.

Both independent rider sessions saw the same target at revision 6. Dispatch
and claim timings:

| Client | Start (UTC) | Transport result | Elapsed |
|---|---|---|---:|
| rider 1 | 2026-08-02T02:13:23.608Z | HTTP 200, winner | 239 ms |
| rider 2 | 2026-08-02T02:13:23.609Z | timeout; no mutation | 8001 ms |

The server-authoritative result was:

- final status `assigned`;
- final revision 7, exactly 6 + 1;
- assigned rider matched rider 1 and did not match rider 2;
- one `order.rider_claimed` event only, sequence 95;
- effective claim event time `2026-08-02T02:13:23.87335Z`;
- six total events, sequences 90 through 95.

The explicit post-race loser check returned HTTP 200 with zero occurrences of
`LT-0011` in rider 2 available orders and zero rider 2 assigned orders. The
winner retry with the original revision returned HTTP 200 and
`idempotent_no_op=true`; event count and revision remained unchanged. The
loser did not reassign the order. No commercial order was used or modified by
this race.

## Android physical flow

Device: Moto G15, Android 15.

- Configured staging APK installed; config verification used only lengths 40,
  208, and 36 for URL, publishable key, and business ID.
- Real rider QA login passed with no crash.
- Synthetic order `LT-0010` was visible at revision 6.
- Detail screen exposed `Tomar pedido`.
- Physical capture shows `Tomando pedido...`:
  `captures/moto-g15-staging-task04-claim-taking.png`.
- The final screen showed `Pedido asignado a vos`, order `LT-0010`, revision 7,
  then refresh removed the temporary error banner and left the assigned order
  visible. The address shown in captures is synthetic QA data only.
- No delivery start, GPS, map, permission, or ForegroundService flow was run.
- Sanitized logcat check: zero fatal/crash matches; package remained running.

## Gates

- `flutter analyze`: PASS, 0 issues.
- `flutter test`: PASS, 23 tests.
- `testStagingDebugUnitTest`: PASS.
- `testProductionDebugUnitTest`: PASS.
- `connectedStagingDebugAndroidTest`: PASS, 2 tests on Moto G15 / Android 15.
- Configured staging APK build: PASS.
- Production APK build: PASS and fail-closed without production backend data.

## Worktree state

Existing local Task 04 changes in the Android worktree and unrelated local
backend changes were preserved. No source code changes were made during this
run.

## Verdict

LA_TABA_RIDER_ANDROID_TASK04_CLAIM_READY_FOR_REVIEW
