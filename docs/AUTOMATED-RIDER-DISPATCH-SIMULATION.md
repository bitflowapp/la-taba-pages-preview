# Simulacion deterministica de auto-dispatch

Resultado: **PASS**  
SHA-256 deterministico: `9d87db73b4ce5d08a125df810ff0bb7589f62e0f566b819e359edd2a3998c406`  
Escenarios: 44

| Escenario | Jobs | Offers | Claims | Sin Rider | Jain | Claims/rewards duplicados |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 01-riders-single-order | 1 | 1 | 1 | 0 | 1.000 | 0/0 |
| 01-riders-simultaneous-burst | 3 | 3 | 3 | 0 | 1.000 | 0/0 |
| 01-riders-distributed-zones | 2 | 1 | 1 | 1 | 1.000 | 0/0 |
| 01-riders-closest-always-rejects | 2 | 2 | 0 | 2 | 1.000 | 0/0 |
| 01-riders-first-offer-times-out | 2 | 1 | 0 | 2 | 1.000 | 0/0 |
| 01-riders-all-reject | 2 | 2 | 0 | 2 | 1.000 | 0/0 |
| 01-riders-one-stale | 2 | 1 | 0 | 2 | 1.000 | 0/0 |
| 01-riders-all-at-capacity | 1 | 0 | 0 | 1 | 1.000 | 0/0 |
| 01-riders-reconnect | 1 | 1 | 1 | 0 | 1.000 | 0/0 |
| 01-riders-duplicate-ready-event | 1 | 1 | 1 | 0 | 1.000 | 0/0 |
| 01-riders-shift-ends-during-delivery | 1 | 1 | 1 | 0 | 1.000 | 0/0 |
| 02-riders-single-order | 1 | 1 | 1 | 0 | 0.500 | 0/0 |
| 02-riders-simultaneous-burst | 6 | 6 | 6 | 0 | 1.000 | 0/0 |
| 02-riders-distributed-zones | 4 | 4 | 4 | 0 | 1.000 | 0/0 |
| 02-riders-closest-always-rejects | 2 | 4 | 2 | 0 | 0.500 | 0/0 |
| 02-riders-first-offer-times-out | 2 | 3 | 2 | 0 | 0.500 | 0/0 |
| 02-riders-all-reject | 2 | 4 | 0 | 2 | 1.000 | 0/0 |
| 02-riders-one-stale | 2 | 2 | 2 | 0 | 0.500 | 0/0 |
| 02-riders-all-at-capacity | 1 | 0 | 0 | 1 | 1.000 | 0/0 |
| 02-riders-reconnect | 1 | 1 | 1 | 0 | 0.500 | 0/0 |
| 02-riders-duplicate-ready-event | 1 | 1 | 1 | 0 | 0.500 | 0/0 |
| 02-riders-shift-ends-during-delivery | 1 | 1 | 1 | 0 | 0.500 | 0/0 |
| 05-riders-single-order | 1 | 1 | 1 | 0 | 0.200 | 0/0 |
| 05-riders-simultaneous-burst | 15 | 15 | 15 | 0 | 1.000 | 0/0 |
| 05-riders-distributed-zones | 10 | 10 | 10 | 0 | 0.909 | 0/0 |
| 05-riders-closest-always-rejects | 5 | 10 | 5 | 0 | 0.714 | 0/0 |
| 05-riders-first-offer-times-out | 5 | 6 | 5 | 0 | 0.714 | 0/0 |
| 05-riders-all-reject | 5 | 25 | 0 | 5 | 1.000 | 0/0 |
| 05-riders-one-stale | 5 | 5 | 5 | 0 | 0.714 | 0/0 |
| 05-riders-all-at-capacity | 1 | 0 | 0 | 1 | 1.000 | 0/0 |
| 05-riders-reconnect | 1 | 1 | 1 | 0 | 0.200 | 0/0 |
| 05-riders-duplicate-ready-event | 1 | 1 | 1 | 0 | 0.200 | 0/0 |
| 05-riders-shift-ends-during-delivery | 1 | 1 | 1 | 0 | 0.200 | 0/0 |
| 10-riders-single-order | 1 | 1 | 1 | 0 | 0.100 | 0/0 |
| 10-riders-simultaneous-burst | 30 | 30 | 30 | 0 | 1.000 | 0/0 |
| 10-riders-distributed-zones | 20 | 20 | 20 | 0 | 1.000 | 0/0 |
| 10-riders-closest-always-rejects | 10 | 20 | 10 | 0 | 0.833 | 0/0 |
| 10-riders-first-offer-times-out | 10 | 12 | 10 | 0 | 0.833 | 0/0 |
| 10-riders-all-reject | 10 | 100 | 0 | 10 | 1.000 | 0/0 |
| 10-riders-one-stale | 10 | 10 | 10 | 0 | 0.833 | 0/0 |
| 10-riders-all-at-capacity | 1 | 0 | 0 | 1 | 1.000 | 0/0 |
| 10-riders-reconnect | 1 | 1 | 1 | 0 | 0.100 | 0/0 |
| 10-riders-duplicate-ready-event | 1 | 1 | 1 | 0 | 0.100 | 0/0 |
| 10-riders-shift-ends-during-delivery | 1 | 1 | 1 | 0 | 0.100 | 0/0 |

La corrida usa reloj virtual, cola estable y cero aleatoriedad. La atomicidad PostgreSQL se certifica por separado; este arnes prueba ranking, leases, retries, fairness y ausencia de starvation evidente bajo sus fixtures.
