# Rider piloto · estado verificado

`jariel1970+rider@gmail.com` · `be333e7e-2c18-4674-af7f-97f581646550`

| control | resultado |
|---|---|
| solicitud | **approved** · rol otorgado `rider` |
| **quién decidió** | `61f238ad…` = la cuenta **owner de Marco** |
| cuándo | 2026-08-18 00:36:15 UTC |
| auditoría | `access_request_approved` · `actor_role = owner` |
| membresía | `rider` · **activa** · comercio `00000000-…-0001` |
| `rider_profile` | **active** · «Marco Luna» · moto |
| owner/admin | **0** — sin escalada |
| `identity_user_security` | 1 |
| sesiones vivas | 0 — no volvió a entrar desde la aprobación |
| filas de GPS | 0 — esperable, todavía no repartió |

**PASS.** Y lo decidió una persona autenticada desde el Panel: el `decided_by`
apunta a la cuenta de Marco y el evento dice `owner`, no `system`. La corrección
de navegación del Panel funcionó de punta a punta.

No se creó ningún segundo Rider.
