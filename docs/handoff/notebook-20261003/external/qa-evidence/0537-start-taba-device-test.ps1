[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RuntimeRoot = 'C:\1212\taba-device-test-runtime'
$Worktree = 'C:\1212\la-taba-s23-iphone-test'
$ExpectedCommit = 'cb49a32483475492efc80602b5914e2fbc76737e'
$ProjectRef = 'yakhtrkukqlgzvxuvhzs'
$ProjectName = 'la-taba-demo'
$AccessPath = Join-Path $RuntimeRoot 'device-test-access.txt'
$ValidatorPath = Join-Path $RuntimeRoot 'validate-qa-runtime.mjs'
$RuntimeConfigPath = Join-Path $RuntimeRoot 'runtime-config.local.js'
$ServerScriptPath = Join-Path $RuntimeRoot 'secure-frontend-server.mjs'
$SmokePath = Join-Path $RuntimeRoot 'public-device-smoke.mjs'
$SessionPath = Join-Path $RuntimeRoot 'session.json'
$ReadyPath = Join-Path $RuntimeRoot 'device-test-ready.txt'
$SupervisorLogPath = Join-Path $RuntimeRoot 'session-supervisor.log'
$EventPath = Join-Path $RuntimeRoot 'test-events.csv'
$FrontendStdoutPath = Join-Path $RuntimeRoot 'frontend.stdout.log'
$FrontendStderrPath = Join-Path $RuntimeRoot 'frontend.stderr.log'
$TunnelStdoutPath = Join-Path $RuntimeRoot 'cloudflared.stdout.log'
$TunnelStderrPath = Join-Path $RuntimeRoot 'cloudflared.stderr.log'
$FrontendPidPath = Join-Path $RuntimeRoot 'frontend.pid'
$TunnelPidPath = Join-Path $RuntimeRoot 'cloudflared.pid'
$Port = 4173

$script:FrontendProcess = $null
$script:TunnelProcess = $null
$script:Completed = $false
$script:CheckRoot = $null

function Write-SafeLog {
  param([Parameter(Mandatory)][string]$Message)
  $safe = $Message `
    -replace '\b[0-9a-f]{8}-[0-9a-f-]{27}\b', '[id]' `
    -replace '\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[email]' `
    -replace '\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b', '[key]' `
    -replace '\beyJ[A-Za-z0-9_.-]+\b', '[token]'
  Add-Content -LiteralPath $SupervisorLogPath -Value (
    '{0:o} {1}' -f (Get-Date), $safe.Substring(0, [Math]::Min(500, $safe.Length))
  ) -Encoding UTF8
}

function Write-TestEvent {
  param(
    [Parameter(Mandatory)][string]$Stage,
    [Parameter(Mandatory)][string]$Status
  )
  Add-Content -LiteralPath $EventPath -Value (
    '"{0:o}","{1}","{2}"' -f (Get-Date), $Stage, $Status
  ) -Encoding UTF8
}

function ConvertFrom-TabaSecureString {
  param([Parameter(Mandatory)][Security.SecureString]$SecureValue)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Assert-File {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Falta un archivo requerido fuera de Git: $([IO.Path]::GetFileName($Path))"
  }
}

function Invoke-SafeNodeStage {
  param(
    [Parameter(Mandatory)][string]$ScriptPath,
    [string[]]$Arguments = @()
  )
  $lines = @(& node $ScriptPath @Arguments 2>&1)
  $exitCode = $LASTEXITCODE
  foreach ($line in $lines) {
    $text = [string]$line
    if ($text) {
      Write-Host $text
      Write-SafeLog $text
    }
  }
  if ($exitCode -ne 0) {
    throw "La etapa Node falló con código $exitCode."
  }
  return $lines
}

function Invoke-SupabaseCli {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Label
  )
  $stdoutPath = Join-Path $RuntimeRoot "$Label.stdout.tmp"
  $stderrPath = Join-Path $RuntimeRoot "$Label.stderr.tmp"
  foreach ($path in @($stdoutPath, $stderrPath)) {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path
    }
  }
  $process = Start-Process -FilePath 'npx.cmd' -ArgumentList (
    @('--yes', 'supabase@latest', '--output-format', 'json') + $Arguments
  ) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath -Wait -PassThru
  $stdout = if (Test-Path -LiteralPath $stdoutPath) {
    Get-Content -LiteralPath $stdoutPath -Raw
  } else {
    ''
  }
  if ($process.ExitCode -ne 0) {
    $safeError = if (Test-Path -LiteralPath $stderrPath) {
      (Get-Content -LiteralPath $stderrPath -Raw) `
        -replace '\b[0-9a-f]{8}-[0-9a-f-]{27}\b', '[id]' `
        -replace '\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b', '[key]'
    } else {
      'sin detalle'
    }
    throw "Supabase CLI falló en $Label`: $($safeError.Substring(0, [Math]::Min(240, $safeError.Length)))"
  }
  Remove-Item -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stderrPath -ErrorAction SilentlyContinue
  return $stdout
}

function Wait-HttpOk {
  param(
    [Parameter(Mandatory)][string]$Url,
    [int]$Attempts = 30
  )
  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
      if ($response.StatusCode -eq 200) {
        return
      }
    } catch {
      if ($attempt -eq $Attempts) {
        throw "No se obtuvo HTTP 200 para la etapa solicitada."
      }
    }
    Start-Sleep -Milliseconds 750
  }
  throw 'No se obtuvo HTTP 200 para la etapa solicitada.'
}

function Get-TunnelUrl {
  for ($attempt = 1; $attempt -le 80; $attempt += 1) {
    $combined = ''
    foreach ($path in @($TunnelStdoutPath, $TunnelStderrPath)) {
      if (Test-Path -LiteralPath $path) {
        $combined += [Environment]::NewLine + (Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue)
      }
    }
    $match = [regex]::Match($combined, 'https://[a-z0-9-]+\.trycloudflare\.com', 'IgnoreCase')
    if ($match.Success) {
      return $match.Value.TrimEnd('/')
    }
    if ($script:TunnelProcess.HasExited) {
      throw 'Cloudflare Quick Tunnel finalizó antes de entregar una URL.'
    }
    Start-Sleep -Milliseconds 750
  }
  throw 'Cloudflare Quick Tunnel no entregó una URL dentro del tiempo esperado.'
}

function Stop-OwnedProcessesOnFailure {
  if ($script:Completed) {
    return
  }
  foreach ($process in @($script:TunnelProcess, $script:FrontendProcess)) {
    if ($null -ne $process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    }
  }
}

New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
Set-Content -LiteralPath $SupervisorLogPath -Value (
  '{0:o} TABA device-test supervisor started' -f (Get-Date)
) -Encoding UTF8
if (-not (Test-Path -LiteralPath $EventPath)) {
  Set-Content -LiteralPath $EventPath -Value '"timestamp","stage","status"' -Encoding UTF8
}
foreach ($path in @(
  $ReadyPath,
  $SessionPath,
  $FrontendStdoutPath,
  $FrontendStderrPath,
  $TunnelStdoutPath,
  $TunnelStderrPath,
  $FrontendPidPath,
  $TunnelPidPath
)) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path
  }
}

try {
  Assert-File $AccessPath
  Assert-File $ValidatorPath
  Assert-File $ServerScriptPath
  Assert-File $SmokePath
  if ((Get-Item -LiteralPath $AccessPath).Length -le 0) {
    throw 'El archivo local de credenciales QA está vacío.'
  }

  $actualCommit = (& git -C $Worktree rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $ExpectedCommit) {
    throw 'El worktree no está en el commit exacto autorizado.'
  }
  $worktreeStatus = @(& git -C $Worktree status --porcelain)
  if ($LASTEXITCODE -ne 0 -or $worktreeStatus.Count -ne 0) {
    throw 'El worktree exacto no está limpio.'
  }
  Write-SafeLog 'worktree exact commit and clean: OK'
  Write-TestEvent 'worktree' 'OK'

  $migrationSource = Join-Path $Worktree 'supabase\migrations'
  $localMigrationFiles = @(Get-ChildItem -LiteralPath $migrationSource -File -Filter '*.sql')
  if ($localMigrationFiles.Count -ne 13) {
    throw "El snapshot exacto contiene $($localMigrationFiles.Count) migraciones en lugar de 13."
  }
  $checkRoot = Join-Path $RuntimeRoot ("supabase-check-{0}" -f $PID)
  $script:CheckRoot = $checkRoot
  $checkSupabase = Join-Path $checkRoot 'supabase'
  $checkMigrations = Join-Path $checkSupabase 'migrations'
  $checkTemp = Join-Path $checkSupabase '.temp'
  New-Item -ItemType Directory -Path $checkRoot -Force | Out-Null
  Invoke-SupabaseCli -Arguments @('--workdir', $checkRoot, 'init') `
    -Label 'supabase-init' | Out-Null
  New-Item -ItemType Directory -Path $checkMigrations -Force | Out-Null
  New-Item -ItemType Directory -Path $checkTemp -Force | Out-Null
  Copy-Item -Path (Join-Path $migrationSource '*.sql') -Destination $checkMigrations
  Set-Content -LiteralPath (Join-Path $checkTemp 'project-ref') -Value $ProjectRef -NoNewline -Encoding ASCII

  $projectJson = Invoke-SupabaseCli -Arguments @(
    '--workdir', $checkRoot, 'projects', 'list'
  ) -Label 'supabase-project'
  $projectResult = ($projectJson | ConvertFrom-Json)
  $projects = if ($projectResult.projects) {
    @($projectResult.projects)
  } else {
    @($projectResult)
  }
  $project = @($projects | Where-Object {
    $_.ref -eq $ProjectRef -and $_.name -eq $ProjectName
  })
  if ($project.Count -ne 1 -or $project[0].status -ne 'ACTIVE_HEALTHY') {
    throw 'Supabase staging no está ACTIVE_HEALTHY.'
  }

  $migrationJson = Invoke-SupabaseCli -Arguments @(
    '--workdir', $checkRoot, 'migration', 'list', '--linked'
  ) -Label 'supabase-migrations'
  $migrationResult = ($migrationJson | ConvertFrom-Json)
  $migrationRows = @($migrationResult.migrations)
  $missingRemote = @($migrationRows | Where-Object {
    -not $_.remote -or $_.local -ne $_.remote
  })
  if ($migrationRows.Count -ne 13 -or $missingRemote.Count -ne 0) {
    throw 'Las 13 migraciones del snapshot no coinciden exactamente con staging.'
  }
  $resolvedCheckRoot = (Resolve-Path -LiteralPath $checkRoot).Path
  if (-not $resolvedCheckRoot.StartsWith("$RuntimeRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw 'La carpeta temporal de Supabase quedó fuera del runtime autorizado.'
  }
  Remove-Item -LiteralPath $resolvedCheckRoot -Recurse
  $script:CheckRoot = $null
  Write-SafeLog 'Supabase ACTIVE_HEALTHY and 13 migrations aligned: OK'
  Write-TestEvent 'supabase_and_migrations' 'OK'

  $secretSecure = Read-Host 'Secret key activa de la-taba-demo' -AsSecureString
  $secretPlain = ConvertFrom-TabaSecureString $secretSecure
  $secretSecure.Dispose()
  if ($secretPlain -notmatch '^sb_secret_[A-Za-z0-9_-]{20,}$') {
    $secretPlain = $null
    throw 'La secret ingresada no tiene el formato sb_secret_ requerido.'
  }

  $publishableSecure = Read-Host 'Publishable key activa de la-taba-demo' -AsSecureString
  $publishablePlain = ConvertFrom-TabaSecureString $publishableSecure
  $publishableSecure.Dispose()
  if ($publishablePlain -notmatch '^sb_publishable_[A-Za-z0-9_-]{20,}$') {
    $secretPlain = $null
    $publishablePlain = $null
    throw 'La publishable key ingresada no tiene el formato sb_publishable_ requerido.'
  }

  $env:TABA_QA_SUPABASE_SECRET = $secretPlain
  $env:TABA_QA_SUPABASE_PUBLISHABLE = $publishablePlain
  try {
    Invoke-SafeNodeStage -ScriptPath $ValidatorPath | Out-Null
  } finally {
    Remove-Item Env:\TABA_QA_SUPABASE_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:\TABA_QA_SUPABASE_PUBLISHABLE -ErrorAction SilentlyContinue
    $secretPlain = $null
  }
  Assert-File $RuntimeConfigPath
  Write-TestEvent 'qa_directory_and_anonymous_auth' 'OK'

  $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port `
    -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    throw "El puerto local $Port ya está ocupado; no se detuvo ningún proceso ajeno."
  }
  $script:FrontendProcess = Start-Process -FilePath 'node.exe' -ArgumentList @(
    $ServerScriptPath,
    $Worktree,
    $RuntimeConfigPath,
    [string]$Port
  ) -WindowStyle Hidden -RedirectStandardOutput $FrontendStdoutPath `
    -RedirectStandardError $FrontendStderrPath -PassThru
  Set-Content -LiteralPath $FrontendPidPath -Value $script:FrontendProcess.Id -Encoding ASCII
  Wait-HttpOk -Url "http://127.0.0.1:$Port/"
  Wait-HttpOk -Url "http://127.0.0.1:$Port/runtime-config.js"
  if ($script:FrontendProcess.HasExited) {
    throw 'El servidor frontend finalizó durante el smoke local.'
  }
  Write-SafeLog 'local frontend HTTP 200: OK'
  Write-TestEvent 'local_frontend' 'OK'

  $cloudflared = (Get-Command cloudflared.exe -ErrorAction Stop).Source
  $script:TunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList @(
    'tunnel',
    '--url',
    "http://127.0.0.1:$Port",
    '--no-autoupdate',
    '--loglevel',
    'info'
  ) -WindowStyle Hidden -RedirectStandardOutput $TunnelStdoutPath `
    -RedirectStandardError $TunnelStderrPath -PassThru
  Set-Content -LiteralPath $TunnelPidPath -Value $script:TunnelProcess.Id -Encoding ASCII
  $tunnelUrl = Get-TunnelUrl
  Wait-HttpOk -Url "$tunnelUrl/"
  if ($script:TunnelProcess.HasExited) {
    throw 'Cloudflare Quick Tunnel finalizó durante el smoke público.'
  }
  Write-SafeLog 'current Cloudflare Quick Tunnel HTTP 200: OK'
  Write-TestEvent 'quick_tunnel' 'OK'

  $smokeLines = @(& node $SmokePath $tunnelUrl 2>&1)
  $smokeExit = $LASTEXITCODE
  foreach ($line in $smokeLines) {
    $text = [string]$line
    if ($text) {
      Write-Host $text
      Write-SafeLog $text
    }
  }
  if ($smokeExit -ne 0) {
    $transient = ($smokeLines -join ' ') -match (
      'fetch failed|HTTP 502|ERR_NAME_NOT_RESOLVED|timed out|Timeout|ECONNRESET'
    )
    if (-not $transient) {
      throw 'El smoke público falló por una causa no transitoria.'
    }
    Write-SafeLog 'public smoke transient edge propagation; one delayed retry'
    Start-Sleep -Seconds 5
    Invoke-SafeNodeStage -ScriptPath $SmokePath -Arguments @($tunnelUrl) | Out-Null
  }
  Write-TestEvent 'public_smoke' 'OK'

  if ($script:FrontendProcess.HasExited -or $script:TunnelProcess.HasExited) {
    throw 'Un proceso requerido finalizó después del smoke.'
  }
  $secretLeakPattern = 'sb_secret_|service_role|access_token|refresh_token|Password:'
  foreach ($logPath in @(
    $SupervisorLogPath,
    $FrontendStdoutPath,
    $FrontendStderrPath,
    $TunnelStdoutPath,
    $TunnelStderrPath
  )) {
    if (
      (Test-Path -LiteralPath $logPath) -and
      (Select-String -LiteralPath $logPath -Pattern $secretLeakPattern -Quiet)
    ) {
      throw 'Se detectó material sensible en un log; no se publica la sesión.'
    }
  }

  $session = [ordered]@{
    readyAt = (Get-Date).ToString('o')
    commit = $ExpectedCommit
    project = $ProjectName
    migrations = 13
    ownerQa = 'OK'
    riderQa = 'OK'
    directory = 'OK'
    anonymousAuth = 'OK'
    localServer = 'OK'
    cloudflareTunnel = 'OK'
    publicSmoke = 'OK'
    serverPid = $script:FrontendProcess.Id
    tunnelPid = $script:TunnelProcess.Id
    clientUrl = "$tunnelUrl/"
    businessUrl = "$tunnelUrl/#business"
    riderUrl = "$tunnelUrl/#rider"
    sanitizedLog = $SupervisorLogPath
    supervisor = $MyInvocation.MyCommand.Path
  }
  Set-Content -LiteralPath $SessionPath -Value (
    $session | ConvertTo-Json -Depth 3
  ) -Encoding UTF8

  $ready = @"
TABA_DEVICE_TEST_READY

- Supabase: OK
- 13 migraciones: OK
- Owner QA: OK
- Rider QA: OK
- directorio operativo: OK
- Auth anónima: OK
- servidor local: OK
- túnel Cloudflare: OK
- smoke público: OK
- procesos activos: sí
- PID servidor: $($script:FrontendProcess.Id)
- PID túnel: $($script:TunnelProcess.Id)
- URL cliente: $tunnelUrl/
- URL negocio: $tunnelUrl/#business
- URL rider: $tunnelUrl/#rider
- ruta del log sanitizado: $SupervisorLogPath
- ruta del script supervisor: $($MyInvocation.MyCommand.Path)
"@
  Set-Content -LiteralPath $ReadyPath -Value $ready -Encoding UTF8
  Write-SafeLog 'TABA_DEVICE_TEST_READY'
  Write-TestEvent 'session_ready' 'OK'
  $script:Completed = $true
  $publishablePlain = $null
  Write-Host $ready
} catch {
  Remove-Item Env:\TABA_QA_SUPABASE_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:\TABA_QA_SUPABASE_PUBLISHABLE -ErrorAction SilentlyContinue
  $secretPlain = $null
  $publishablePlain = $null
  $safeError = ([string]$_.Exception.Message) `
    -replace '\b[0-9a-f]{8}-[0-9a-f-]{27}\b', '[id]' `
    -replace '\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[email]' `
    -replace '\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b', '[key]' `
    -replace '\beyJ[A-Za-z0-9_.-]+\b', '[token]'
  Write-SafeLog "FAILED: $safeError"
  Write-TestEvent 'session_ready' 'FAILED'
  Write-Error "TABA_DEVICE_TEST_FAILED: $safeError"
} finally {
  if ($script:CheckRoot -and (Test-Path -LiteralPath $script:CheckRoot)) {
    $resolvedCheckRoot = (Resolve-Path -LiteralPath $script:CheckRoot).Path
    if ($resolvedCheckRoot.StartsWith("$RuntimeRoot\", [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedCheckRoot -Recurse -ErrorAction SilentlyContinue
    }
  }
  Stop-OwnedProcessesOnFailure
}
