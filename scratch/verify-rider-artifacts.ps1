# PowerShell script to verify signed Rider production artifacts

$ErrorActionPreference = "Stop"

$riderDir = "D:\1212\la-taba-rider-production-rc1"
$aabPath = Join-Path $riderDir "build\app\outputs\bundle\productionRelease\app-production-release.aab"
$apkPath = Join-Path $riderDir "build\app\outputs\flutter-apk\app-production-release.apk"

Write-Host "--- ARTIFACT SIZES AND SHA-256 HASHES ---"
$aabFile = Get-Item $aabPath
$aabHash = Get-FileHash -Path $aabPath -Algorithm SHA256
Write-Host "AAB Path: $aabPath"
Write-Host "AAB Size: $($aabFile.Length) bytes ($([Math]::Round($aabFile.Length / 1MB, 2)) MB)"
Write-Host "AAB SHA-256: $($aabHash.Hash)"

$apkFile = Get-Item $apkPath
$apkHash = Get-FileHash -Path $apkPath -Algorithm SHA256
Write-Host "`nAPK Path: $apkPath"
Write-Host "APK Size: $($apkFile.Length) bytes ($([Math]::Round($apkFile.Length / 1MB, 2)) MB)"
Write-Host "APK SHA-256: $($apkHash.Hash)"

Write-Host "`n--- VERIFYING AAB CERTIFICATE WITH KEYTOOL ---"
$aabCert = & keytool -printcert -jarfile $aabPath
Write-Host ($aabCert -join "`n")

Write-Host "`n--- VERIFYING APK CERTIFICATE WITH KEYTOOL ---"
$apkCert = & keytool -printcert -jarfile $apkPath
Write-Host ($apkCert -join "`n")

Write-Host "`n--- JARSIGNER VERIFICATION ON AAB ---"
& jarsigner -verify -strict $aabPath

Write-Host "`n--- JARSIGNER VERIFICATION ON APK ---"
& jarsigner -verify -strict $apkPath

Write-Host "`nVerification completed successfully."
