use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackingCacheSnapshot {
    pub schema_version: i64,
    pub business_id: String,
    pub server_session_id: String,
    pub order_id: String,
    pub order_revision: i64,
    pub operator_id: String,
    pub state: String,
    pub items: Vec<PackingCacheItem>,
    pub scans: Vec<PackingCacheScan>,
    pub saved_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackingCacheItem {
    pub product_id: String,
    pub name: String,
    pub required: i64,
    pub barcodes: Vec<PackingCacheBarcode>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackingCacheBarcode {
    pub gtin: String,
    pub unit_factor: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackingCacheScan {
    pub scan_key: String,
    pub gtin: String,
    pub product_id: String,
    pub unit_factor: i64,
    pub at: String,
    pub sync_state: String,
}

pub fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS local_packing_cache (
               business_id TEXT PRIMARY KEY,
               snapshot_json TEXT NOT NULL,
               snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS local_packing_cache_events (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               business_id TEXT NOT NULL,
               event_type TEXT NOT NULL CHECK(event_type IN ('saved','deleted','corrupt')),
               snapshot_sha256 TEXT,
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE INDEX IF NOT EXISTS local_packing_cache_events_business_idx
               ON local_packing_cache_events(business_id,created_at DESC);",
        )
        .map_err(db_error)
}

pub fn save(
    connection: &mut Connection,
    snapshot: &PackingCacheSnapshot,
) -> Result<PackingCacheSnapshot, String> {
    validate(snapshot)?;
    let encoded =
        serde_json::to_vec(snapshot).map_err(|_| "Caché de packing inválida.".to_string())?;
    if encoded.len() > 2_000_000 {
        return Err("La caché de packing excede el límite local.".into());
    }
    let sha256 = format!("{:x}", Sha256::digest(&encoded));
    let json = String::from_utf8(encoded).map_err(|_| "Caché de packing inválida.".to_string())?;
    let transaction = connection.transaction().map_err(db_error)?;
    transaction
        .execute(
            "INSERT INTO local_packing_cache(business_id,snapshot_json,snapshot_sha256,updated_at)
             VALUES(?1,?2,?3,?4)
             ON CONFLICT(business_id) DO UPDATE SET
               snapshot_json=excluded.snapshot_json,
               snapshot_sha256=excluded.snapshot_sha256,
               updated_at=excluded.updated_at",
            params![snapshot.business_id, json, sha256, snapshot.saved_at],
        )
        .map_err(db_error)?;
    transaction
        .execute(
            "INSERT INTO local_packing_cache_events(business_id,event_type,snapshot_sha256)
             VALUES(?1,'saved',?2)",
            params![snapshot.business_id, sha256],
        )
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    Ok(snapshot.clone())
}

pub fn load(
    connection: &Connection,
    business_id: &str,
) -> Result<Option<PackingCacheSnapshot>, String> {
    validate_identifier(business_id, "negocio")?;
    let stored = connection
        .query_row(
            "SELECT snapshot_json,snapshot_sha256 FROM local_packing_cache WHERE business_id=?1",
            [business_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(db_error)?;
    let Some((json, expected_sha256)) = stored else {
        return Ok(None);
    };
    let actual_sha256 = format!("{:x}", Sha256::digest(json.as_bytes()));
    if actual_sha256 != expected_sha256 {
        let _ = connection.execute(
            "INSERT INTO local_packing_cache_events(business_id,event_type,snapshot_sha256)
             VALUES(?1,'corrupt',?2)",
            params![business_id, expected_sha256],
        );
        return Err("La caché de packing falló su control de integridad.".into());
    }
    let snapshot: PackingCacheSnapshot = serde_json::from_str(&json)
        .map_err(|_| "La caché de packing no se puede leer.".to_string())?;
    validate(&snapshot)?;
    if snapshot.business_id != business_id {
        return Err("La caché de packing pertenece a otro negocio.".into());
    }
    Ok(Some(snapshot))
}

pub fn delete(connection: &mut Connection, business_id: &str) -> Result<bool, String> {
    validate_identifier(business_id, "negocio")?;
    let transaction = connection.transaction().map_err(db_error)?;
    let removed = transaction
        .execute(
            "DELETE FROM local_packing_cache WHERE business_id=?1",
            [business_id],
        )
        .map_err(db_error)?
        > 0;
    if removed {
        transaction
            .execute(
                "INSERT INTO local_packing_cache_events(business_id,event_type)
                 VALUES(?1,'deleted')",
                [business_id],
            )
            .map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)?;
    Ok(removed)
}

fn validate(snapshot: &PackingCacheSnapshot) -> Result<(), String> {
    if snapshot.schema_version != 1
        || snapshot.order_revision < 1
        || !matches!(
            snapshot.state.as_str(),
            "in_progress" | "complete" | "exception_required"
        )
    {
        return Err("Estado de caché de packing inválido.".into());
    }
    validate_identifier(&snapshot.business_id, "negocio")?;
    validate_identifier(&snapshot.server_session_id, "sesión")?;
    validate_identifier(&snapshot.order_id, "pedido")?;
    validate_identifier(&snapshot.operator_id, "operador")?;
    if snapshot.saved_at.len() < 20 || snapshot.saved_at.len() > 40 {
        return Err("Fecha de caché de packing inválida.".into());
    }
    if snapshot.items.is_empty() || snapshot.items.len() > 500 || snapshot.scans.len() > 5_000 {
        return Err("Contenido de caché de packing fuera de rango.".into());
    }
    for item in &snapshot.items {
        validate_identifier(&item.product_id, "producto")?;
        if item.name.trim().is_empty()
            || item.name.len() > 100
            || item.required < 1
            || item.required > 100_000
            || item.barcodes.is_empty()
            || item.barcodes.len() > 100
        {
            return Err("Item de caché de packing inválido.".into());
        }
        for barcode in &item.barcodes {
            validate_barcode(&barcode.gtin)?;
            if barcode.unit_factor < 1 || barcode.unit_factor > item.required {
                return Err("Factor de barcode fuera de rango.".into());
            }
        }
    }
    for scan in &snapshot.scans {
        validate_identifier(&scan.scan_key, "lectura")?;
        validate_identifier(&scan.product_id, "producto")?;
        validate_barcode(&scan.gtin)?;
        if scan.unit_factor < 1
            || scan.unit_factor > 100_000
            || scan.at.len() < 20
            || scan.at.len() > 40
            || !matches!(scan.sync_state.as_str(), "pending" | "confirmed")
        {
            return Err("Lectura de caché de packing inválida.".into());
        }
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ':' | '_' | '-')
        })
    {
        return Err(format!("Identificador de {label} inválido."));
    }
    Ok(())
}

fn validate_barcode(value: &str) -> Result<(), String> {
    if value.len() < 3
        || value.len() > 32
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
    {
        return Err("Barcode de caché de packing inválido.".into());
    }
    Ok(())
}

fn db_error(error: rusqlite::Error) -> String {
    log::warn!(
        "packing cache database operation failed: {}",
        error
            .sqlite_error_code()
            .map(|code| format!("{code:?}"))
            .unwrap_or_else(|| "unknown".into())
    );
    "No se pudo actualizar la caché local de packing.".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> PackingCacheSnapshot {
        PackingCacheSnapshot {
            schema_version: 1,
            business_id: "business-1".into(),
            server_session_id: "session-1".into(),
            order_id: "order-1".into(),
            order_revision: 2,
            operator_id: "operator-1".into(),
            state: "in_progress".into(),
            items: vec![PackingCacheItem {
                product_id: "product-1".into(),
                name: "Producto sintético".into(),
                required: 2,
                barcodes: vec![PackingCacheBarcode {
                    gtin: "7790001000011".into(),
                    unit_factor: 1,
                }],
            }],
            scans: vec![PackingCacheScan {
                scan_key: "packing-scan:1".into(),
                gtin: "7790001000011".into(),
                product_id: "product-1".into(),
                unit_factor: 1,
                at: "2026-08-02T10:00:00.000Z".into(),
                sync_state: "pending".into(),
            }],
            saved_at: "2026-08-02T10:00:01.000Z".into(),
        }
    }

    #[test]
    fn packing_cache_survives_reopen_and_is_scoped() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        save(&mut connection, &snapshot()).unwrap();
        assert_eq!(load(&connection, "business-1").unwrap(), Some(snapshot()));
        assert_eq!(load(&connection, "business-2").unwrap(), None);
        assert!(delete(&mut connection, "business-1").unwrap());
        assert_eq!(load(&connection, "business-1").unwrap(), None);
    }

    #[test]
    fn packing_cache_rejects_sensitive_or_unbounded_shapes() {
        let mut invalid = snapshot();
        invalid.items[0].name = "".into();
        assert!(validate(&invalid).is_err());
        invalid = snapshot();
        invalid.scans[0].scan_key = "token=not-allowed".into();
        assert!(validate(&invalid).is_err());
    }
}
