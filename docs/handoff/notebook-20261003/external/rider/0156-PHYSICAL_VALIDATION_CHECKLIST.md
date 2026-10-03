# TABA2 Rider — guided physical validation

Run only with a synthetic staging delivery and consented rider account. Never record a delivery code, exact address, phone, token, serial or exact coordinates in the result.

| Step | Action | Expected result |
|---:|---|---|
| 1 | Sign in to staging with an active Rider membership. | TABA2 Rider shows the real queue; invalid membership/role is explained without backend detail. |
| 2 | Open a ready synthetic delivery with two Rider sessions. Claim at the same time. | One assignment only; winner sees assignment, loser sees an honest conflict and refreshes. |
| 3 | Winner selects **Retiré el pedido**. | Server confirms `picked_up` once; repeat is idempotent. |
| 4 | Start delivery and grant contextual notification/location permission. | `on_the_way` is confirmed first; foreground notification and service then run. |
| 5 | Walk/drive a real short route with the screen off. | Fresh real fix is shown as active; no simulated fix is called real. |
| 6 | Disable GPS, then restore it. | UI says GPS off/searching/stale as applicable; delivery state is retained. |
| 7 | Switch Wi-Fi to mobile data, then airplane mode and back. | Visible data is retained; pending state is honest; reconciliation occurs once online. |
| 8 | Mark **Llegué al destino** with a stale revision, refresh, then retry. | Stale conflict is explicit; valid retry confirms `arrived`; code field appears only then. |
| 9 | Enter an intentionally wrong synthetic code until server lock response. | Incorrect and wait messages are distinct; no local delivered state; input clears only after a confirmed wrong code. |
| 10 | After allowed retry, enter the correct synthetic code. | Server confirms delivered once; Rider active delivery disappears, GPS receipt is terminally rejected and foreground service stops. |
| 11 | Verify customer and business views. | All three actors converge on delivered; no code or exact GPS is exposed. |
| 12 | Logout and reopen app. | No active channel/notification remains; no stale active delivery is invented. |

Record each result as PASS, FAIL or BLOCKED plus a sanitized timestamp and error code only.
