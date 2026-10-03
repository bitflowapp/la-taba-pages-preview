# Known limitations

- `data/catalog-real.csv` is a prepared import catalog, not a published catalog.
- New rows are intentionally `available=false`, `stock=0`, and must be confirmed by the business before publication.
- The 44 image sources are public Jumbo retailer assets. SHA-256, dimensions, identity and deterministic normalization are verified, but commercial image authorization is not documented; every row remains `rights_status=PENDIENTE_DERECHOS`.
- The current checkout worktree is not part of this expansion and was not modified.
- The generated demo data pipeline referenced by `js/approved-beverage-demo-data.js` is absent in this base; the 22 demo products remain unchanged.
