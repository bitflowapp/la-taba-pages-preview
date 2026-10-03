# PowerShell script to generate dedicated TABA Android production signing identity
# NEVER print passwords to terminal or report.

$ErrorActionPreference = "Stop"

$secretsDir = "C:\Users\marco\.taba-secrets"
$backupDir = "C:\Users\marco\.taba-secrets\backups"
$keystorePath = Join-Path $secretsDir "taba-rider-production.jks"
$keystoreBak = Join-Path $backupDir "taba-rider-production.jks.bak"
$dpapiPath = Join-Path $secretsDir "taba-rider-keystore-password.dpapi"

if (!(Test-Path $secretsDir)) {
    New-Item -ItemType Directory -Path $secretsDir -Force | Out-Null
}
if (!(Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

if (Test-Path $keystorePath) {
    Write-Host "Keystore already exists at $keystorePath. Aborting generation to prevent overwrite."
    exit 1
}

# Generate cryptographically strong random password (48 characters)
$bytes = New-Object byte[] 36
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$password = [System.Convert]::ToBase64String($bytes)

# Encrypt password with DPAPI and save
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$encryptedPassword = ConvertFrom-SecureString $securePassword
Set-Content -Path $dpapiPath -Value $encryptedPassword -NoNewline

Write-Host "DPAPI password saved to $dpapiPath."

# Generate keystore using keytool
$dname = 'CN=La Taba Delivery, OU=Logistics, O=La Taba, L=Neuquen, ST=Neuquen, C=AR'
$alias = "taba_production"

& keytool -genkeypair -v `
    -keystore $keystorePath `
    -storetype PKCS12 `
    -alias $alias `
    -keyalg RSA `
    -keysize 4096 `
    -sigalg SHA256withRSA `
    -validity 10950 `
    -dname $dname `
    -storepass $password `
    -keypass $password

if ($LASTEXITCODE -ne 0) {
    Write-Error "keytool failed with exit code $LASTEXITCODE"
    exit 1
}

Write-Host "Keystore successfully generated at $keystorePath."

# Copy backup
Copy-Item -Path $keystorePath -Destination $keystoreBak -Force
Write-Host "Backup created at $keystoreBak."

# Extract certificate fingerprint SHA-256
$listArgs = @(
    "-list",
    "-v",
    "-keystore", $keystorePath,
    "-alias", $alias,
    "-storepass", $password
)

$output = & keytool @listArgs
$sha256Line = ($output | Where-Object { $_ -match "SHA256:" -or $_ -match "SHA-256:" })

Write-Host "Certificate Fingerprint:"
Write-Host $sha256Line

$cleanFingerprint = ($sha256Line -replace ".*SHA256:\s*", "" -replace ".*SHA-256:\s*", "").Trim()
Set-Content -Path (Join-Path $secretsDir "taba-rider-cert-sha256.txt") -Value $cleanFingerprint

Write-Host "Fingerprint saved to taba-rider-cert-sha256.txt."
