# Historical A1/A4 V3 remediation

The authoritative production procedure is [the V5 runbook](A1_A4_PRODUCTION_RUNBOOK_V5.md).
V3/V4 operational commands and local JSON release evidence are retired.

The three V3 EXPAND migrations remain immutable and preserve the audited
financial rolling behavior: old Edge works on OLD and EXPAND; new Edge fails
closed on OLD; new Edge works on EXPAND and CONTRACT; old Edge fails closed
after CONTRACT. V5 adds a backward-compatible durable release interlock before
the coordinated three-function release.

The original V3 financial retirement and exactly-once implementation is reused
behind V5's trusted release and drain gates. Historical validation is recorded in
`artifacts/codex/A1_A4_V3_VALIDATION.md`; it is not deployment authorization.
