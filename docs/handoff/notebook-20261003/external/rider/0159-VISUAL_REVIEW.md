# Visual review

Reviewed golden captures from synthetic fixtures in `screenshots/`:

| Surface | Result | Observation |
|---|---|---|
| Queue | PASS | Clear state banner, one primary action per card, large whitespace and red action hierarchy. |
| Detail | PASS | Operational blocks are legible and avoid exact address before claim. |
| Permission | PASS | Contextual explanation precedes tracking; primary CTA is in the thumb zone. |
| GPS active | PASS | Status is visible and not communicated by color alone. |
| GPS weak | PASS | Warning tone and copy distinguish a weak fix from live tracking. |
| Offline | PASS | Confirmed content remains visible with an actionable reconnect state. |

The updated delivery screen adds a single contextual CTA: pickup, start, arrival, or code confirmation. It exposes the code input only after server-confirmed arrival and places controlled issue reporting in a secondary app-bar action.

No overflow was reported by the large-font widget test. Arrival/code/lock/issue/delivered captures are covered functionally by the new DTO and bridge tests, but their final real-device captures remain part of the physical checklist because live staging credentials were unavailable.
