# TABA Gate 2 live physical test

Status: **INCOMPLETE — waiting for Moto G15 reconnection**

## Verified before the device disconnect

- HTTPS temporary origin served the staging frontend on port `4175`.
- External HTTPS HTML returned 200.
- External `runtime-config.js` returned 200 and matched project
  `ukxqbgswjlibmnjemrzd` and the staging business UUID.
- Runtime response contained no `service_role` or `sb_secret_` prefix.
- QA order `LT-0003` was created through `create_order_with_items` and moved
  through `transition_order` RPCs to `ready`.
- Two independent rider sessions competed for the same order. Rider 1 won;
  the order persisted as `assigned`, revision `7`.
- Rider 2's stale revision was rejected with SQLSTATE `40001`.
- Rider 1's repeated claim returned `idempotent_no_op=true` without a revision
  bump.

## Still required

- reconnect `ZY32LHS6PS`;
- open the Rider link from `LIVE_LINKS.txt` with `adb shell am start`;
- login, permit precise GPS, and observe the assigned order;
- start delivery from the Moto UI;
- capture a real GPS fix and a changed fix after physical movement;
- verify customer MapLibre marker/freshness and screen off/on recovery;
- save redacted screenshots and remote verification queries;
- finish/cancel and verify GPS/tracking are hidden.

This artifact contains no password, publishable key, service role, tracking
token, or credential log.
