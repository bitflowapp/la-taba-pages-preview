use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedUpdateStatus {
    pub configured: bool,
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallSignedUpdateRequest {
    pub expected_version: String,
    pub confirmed: bool,
}

pub fn is_configured() -> bool {
    option_env!("TABA_SIGNED_UPDATER_CONFIGURED") == Some("1")
}

#[tauri::command]
pub async fn check_for_signed_update(app: AppHandle) -> Result<SignedUpdateStatus, String> {
    let current_version = app.package_info().version.to_string();
    if !is_configured() {
        return Ok(SignedUpdateStatus {
            configured: false,
            available: false,
            current_version,
            version: None,
        });
    }
    let update = app
        .updater()
        .map_err(|_| "No se pudo inicializar el canal de actualizaciones firmadas.".to_string())?
        .check()
        .await
        .map_err(|_| "No se pudo consultar el canal de actualizaciones firmadas.".to_string())?;
    Ok(SignedUpdateStatus {
        configured: true,
        available: update.is_some(),
        current_version,
        version: update.map(|candidate| candidate.version),
    })
}

#[tauri::command]
pub async fn install_signed_update(
    app: AppHandle,
    request: InstallSignedUpdateRequest,
) -> Result<bool, String> {
    if !is_configured() {
        return Err(
            "El canal de actualizaciones firmadas no esta configurado en este build.".into(),
        );
    }
    if !request.confirmed
        || request.expected_version.is_empty()
        || request.expected_version.len() > 64
        || !request
            .expected_version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
    {
        return Err("La instalacion requiere confirmacion y una version valida.".into());
    }
    let update = app
        .updater()
        .map_err(|_| "No se pudo inicializar el canal de actualizaciones firmadas.".to_string())?
        .check()
        .await
        .map_err(|_| "No se pudo reconciliar la actualizacion antes de instalar.".to_string())?
        .ok_or_else(|| "Ya no hay una actualizacion disponible.".to_string())?;
    if update.version != request.expected_version {
        return Err("La version disponible cambio; volve a consultar antes de instalar.".into());
    }
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| "La actualizacion firmada no pudo descargarse o instalarse.".to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_build_keeps_signed_channel_disabled() {
        if option_env!("TABA_SIGNED_UPDATER_CONFIGURED").is_none() {
            assert!(!is_configured());
        }
    }

    #[test]
    fn install_request_rejects_unconfirmed_or_unbounded_versions() {
        let invalid = InstallSignedUpdateRequest {
            expected_version: "1.2.3".into(),
            confirmed: false,
        };
        assert!(!invalid.confirmed);
        assert!(invalid.expected_version.len() <= 64);
    }
}
