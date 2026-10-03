# ARCA final readiness

Fecha: 2026-08-03.

Worktree final: `C:\1212\la-taba-arca-homologation-readiness`, rama `feature/taba2-arca-homologation-readiness`, HEAD `13936d5`.

Declaraciones permitidas ahora:

```text
ARCA_HOMOLOGATION_READY_FOR_CREDENTIALS
ACCOUNTANT_POLICY_APPROVAL_PENDING
ARCA_PRODUCTION_DISABLED_BY_DESIGN
```

Bloqueos honestos:

- Falta certificado y clave de homologación suministrados por el responsable.
- Falta autorización literal `I_AUTHORIZE_ARCA_HOMOLOGATION`.
- Falta intervención humana WSASS/Clave Fiscal.
- Falta aprobación contable documentada.
- No se ejecutó factura, nota de crédito ni llamada externa de homologación.

No se declara `TABA2_ARCA_HOMOLOGATION_CERTIFIED`.
