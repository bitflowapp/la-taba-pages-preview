# SOURCE-MATRIX — TABA2-PILOT-RC2-CANDIDATE.1

Fuente de verdad: `D:\1212\TABA2_MASTER_RELEASE_PLAN.md`
SHA-256 verificado: `d756fdbfc2181f2fab9fa4e23b3101f37c0867e2aedb731e19809ef13404587a` ✅

Todo lo de abajo fue reconstruido con `git` en esta sesión. No se tomó ningún HEAD
de contexto previo ni de un HANDOFF.

## 1. Repositorios

| | Web / backend / storefront | Rider Android |
| --- | --- | --- |
| Git | `C:\Users\marco\dev\la-taba-pages-preview\.git` | `D:\1212\la-taba-rider-android\.git` |
| Remoto | `origin` | **ninguno** (verificado: `git remote` vacío) |
| Worktrees registrados | 61 | 4 (3 previos + el de RC2) |
| Tags de release | ninguno antes de esta sesión | ninguno antes de esta sesión |

Confirma §2.1 del plan: un SHA web no identifica «TABA2» por sí solo.

## 2. HEADs verificados contra el plan

### 2.1 Bases canónicas

| Rol | Rama | SHA verificado | Plan | Worktree |
| --- | --- | --- | --- | --- |
| Base web | `release/taba2-first-physical-e2e` | `3d69e6b59cd70e87b4431a99f3875d9c6ab14711` | ✅ coincide | limpio |
| Única integración | `feature/taba2-pilot-ops` | `03c2fbdf4b3ba70dbd116788bb3e8612d0fc491d` | ✅ coincide | limpio |
| Base Rider | `release/taba2-rider-first-physical-e2e` | `7cec5a70969d851fe37cc82aa2ee2f169f5bce7f` | ✅ coincide | — |

El estado canónico de evidencia declarado en el encargo (`3d69e6b` web, `7cec5a7`
Rider) coincide byte a byte con el repositorio real.

### 2.2 Resto de las ramas nombradas por el plan

| Rama | SHA verificado | Plan | Decisión |
| --- | --- | --- | --- |
| `release/taba2-pilot-rc` | `55093e030f3a5c3bc7957a7c38588fcde730dc30` | ✅ | no integrar |
| `release/taba2-pilot-integration` | `a8b93cfa449256595a240c3b33f181941ce6b5eb` | ✅ | no integrar |
| `feature/taba2-arca-fiscal-automation` | `af93aeb6c7538655cdc9ab38daebbfea027bfe3f` | ✅ | no integrar |
| `feature/taba2-whatsapp-commerce` | `c1e7cb66d216086d4951b79390068e09d6a7c8d2` | ✅ | no integrar |
| `feature/taba2-commercial-stories` | `27155217f0c1f68fb474ab7230bff90de22cbbd9` | ✅ | no integrar |
| `feature/taba2-fable-visual-polish` | `c761a8d43a9e4abcd17c7687e3e8a25ad545db93` | ✅ | diferir |
| `feature/taba2-commercial-shelf-stage1` | `9cc051af1712e248117ad50fd19d11e06c040837` | ✅ | esperar datos |
| `release/taba2-mercadopago-staging-rc1` | `0587712be87bc32ebae6be75220eeb863780387c` | ✅ | no mergear |
| `fix/taba2-p0-payment-recovery-ux` | `3e48bb0bcd777276d23c542c60fec94ed8b0ed84` | ✅ | auditar delta |
| `origin/main` | `67187e0dfde4fc49b34a2528aa8d99f1698b4d8a` | ✅ | no es base |
| `main` local | `9cd8f8940671b1d8314a6f25abb6ccb4b8247cc4` | ✅ | no es base |

**Ninguna de estas ramas fue mergeada, tocada ni movida.**

## 3. Ancestros: verificados como no-op

`git merge-base --is-ancestor <rama> 3d69e6b` — las nueve dieron ancestro, y
además el SHA corto de cada una coincide con el que declara §3.1 del plan.

| Rama | SHA | ¿ancestro de la base web? |
| --- | --- | --- |
| `release/taba2-production-rc1` | `4ca22af6d425…` | ✅ no-op |
| `release/taba2-e2e-test-staging-rc` | `6294a989f67a…` | ✅ no-op |
| `feature/taba2-real-orders-ops` | `aed0293c32d5…` | ✅ no-op |
| `feature/taba2-commercial-storefront` | `6dd05655a491…` | ✅ no-op |
| `feature/taba2-business-panel-hardening` | `c7c3bbd5348b…` | ✅ no-op |
| `feature/taba2-tracking-visual-polish` | `4ea98c6d0406…` | ✅ no-op |
| `feature/taba2-commercial-p1-closure` | `b66add06231f…` | ✅ no-op |
| `feature/taba2-unit-catalog-normalization` | `b8ac9a3a5aac…` | ✅ no-op |
| `feature/taba2-retail-unit-publication` | `1c7455029f53…` | ✅ no-op |

Rider — los ocho que §3.3 declara contenidos en `7cec5a7` dieron ancestro:
`434c4d5`, `db645b5`, `f1f3f37`, `214d2b4`, `95294d9`, `8e2b671`, `d1ce78e`, `9b498db`.

La excepción topológica se confirma: **`feature/rider-map-location-contracts`
@ `898cea6d444e63adeed61f8079cead750036da0c` NO es ancestro de `7cec5a7`**, tal
como dice el plan. No se mergeó al APK.

## 4. Composición del candidato

```yaml
name: TABA2-PILOT-RC2-CANDIDATE.1        # nombre reservado, NO congelado
web_parent:          3d69e6b59cd70e87b4431a99f3875d9c6ab14711
required_ops_parent: 03c2fbdf4b3ba70dbd116788bb3e8612d0fc491d
merge_base:          c7c3bbd5348bbd9891661784b600c3d20204b285
web_merge_commit:    9952c9e15e335c5cd46e39a2b0cf1a2e8b8e7a10
web_sha:             f611492a5814bf9aeea2469491e6272b9b99663d   # HEAD RC2
rider_parent:        7cec5a70969d851fe37cc82aa2ee2f169f5bce7f
rider_sha:           ff6d01480b36cfb02fd7e3fb6aabdbdfa6ccf4df   # HEAD RC2 Rider
migration_manifest_sha256: a9b04682a4aa5790a649feadf99aeff282df8fa888a195ebbe8da6d01cf00f06
rider_apk_sha256:      3cb61d528da62edd8b3c00b91186681162836cb6666f575cae6424c5bcd3fda8
rider_test_apk_sha256: 84a7d660f07342f714af7ab4490c256d14cd076646b9a58dbead2da15fc00011
```

Commits locales de esta sesión (sin push):

| SHA | Repo | Qué |
| --- | --- | --- |
| `9952c9e` | web | merge `--no-ff` de Observabilidad sobre la base física |
| `f611492` | web | migración de reconciliación del contrato del mapa (P0.2) |
| `ff6d014` | rider | corrección cold-start offline (P0.8) |

Ramas creadas por esta sesión (locales, sin push):

| Rama | Worktree | Base |
| --- | --- | --- |
| `release/taba2-pilot-rc2` | `D:\1212\worktrees\taba2-pilot-rc2-web` | `3d69e6b` |
| `release/taba2-rider-pilot-rc2` | `D:\1212\worktrees\taba2-rider-pilot-rc2` | `7cec5a7` |

## 5. Preservación (P0.1, parcial)

Tags de auditoría **locales** creados (no se hizo push, por instrucción explícita):

| Tag | Repo | Apunta a |
| --- | --- | --- |
| `TABA2-AUDIT-20260808-WEB-BASE` | web | `3d69e6b…` |
| `TABA2-AUDIT-20260808-WEB-OPS` | web | `03c2fbdf…` |
| `TABA2-AUDIT-20260808-RIDER-BASE` | rider | `7cec5a7…` |

Bundles verificados fuera de `D:\1212` (`C:\Users\marco\taba2-rc2-bundles\`),
ambos con `git bundle verify` = *records a complete history / is okay*:

| Bundle | Bytes | SHA-256 |
| --- | --- | --- |
| `rider-all-20260808.bundle` | 1 184 178 | `f223b37d1d0afc5456db1788888c8095ea3ce33bfecc0eea1c699d4da3535b20` |
| `web-rc2-sources-20260808.bundle` | 81 034 120 | `40f59401418be575667a56d4e1b5f5dbb8bea9e485f2ef694b9847b103e7db43` |

El bundle del Rider importa especialmente: ese repositorio **no tiene ningún
remoto**, así que hasta ahora vivía en una sola copia, en un solo disco.

**P0.1 NO está cerrado**: el plan exige publicar ramas/tags y crear un remoto
Rider. El encargo prohíbe `push`. Los bundles son el «mínimo inmediato» que el
propio plan admite, no el cierre del P0.

## 6. Superficie de staging capturada (read-only, sin PII)

`la-taba-staging` = `ukxqbgswjlibmnjemrzd`. Sólo metadatos; no se exportó ni una fila.

| Edge Function | Versión | verify_jwt | `ezbr_sha256` |
| --- | --- | --- | --- |
| `mercadopago-payment-worker` | 13 | false | `80abb9f71c77cb979c81618e3505c8f5ab33f5b3860503f1b6db3d439de0f800` |
| `mercadopago-webhook` | 13 | false | `7566643414c4be217d34fb91d0ce7cc814fc77cd81fc6bb69de552e2b25bec19` |
| `mercadopago-create-checkout-session` | 11 | false | `7b78e3e8e883f59df8e49df97702f75a9e75aa2bd1cf12b237501c09909c0b57` |
| `mercadopago-create-preference` | 13 | false | `8dd89aba410d33e5b736e55812369b8a50f563e7a8bc2d438b0f136ee4a9a449` |
| `mercadopago-checkout-status` | 12 | false | `bfa58e2e4ae5e0851f7ee952bc5a2f69f7a1f69cce2de13f79dd8973b7c7a3b2` |
| `mercadopago-refund` | 2 | true | `ce02a0465ea2593cbc13698d7a18820e179b04b9d0a82fe0357a2c56e122076b` |

`la-taba-demo` (`yakhtrkukqlgzvxuvhzs`) existe en la misma organización y **no fue
tocada**, igual que producción.

## 7. Locks

Leídos los 10 locks antes de tocar nada. Ninguno fue borrado, movido ni reescrito.

| Lock | Estado | Efecto sobre esta sesión |
| --- | --- | --- |
| `taba2-staging-mutation.lock` | `CERRADO_CERTIFICADO` | libre; no se tomó porque no se mutó staging |
| `moto-g15.lock` | `CERRADO_CON_PUNTO_PROVISIONAL` | libre |
| `taba2-walter-commercial-demo.txt` | **ACTIVO** | se respetó: no se escribió en sus dos worktrees, no se usó su puerto 8471 |
| `taba2-pilot-ops.txt` | `CLOSED` | ver discrepancia D-1 en INTEGRATION-LOG |
| `taba2-pilot-integration-staging.txt` | `CLOSED` | — |
| `taba2-business-panel-hardening.txt` | `CLOSED` | — |
| `taba2-whatsapp-commerce.txt` | `CLOSED` | — |
| `rc1-business-certification-pending.txt` | pendiente viejo | — |
| `rider-staging-smoke-pending.txt` | `BLOCKED_NOT_STARTED` | — |
| `storefront-pending.txt` | pendiente viejo | — |

Lock propio escrito: `D:\1212\_claude-locks\taba2-pilot-rc2-candidate.txt`.
