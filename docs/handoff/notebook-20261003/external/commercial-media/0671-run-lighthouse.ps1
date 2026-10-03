param(
  [string]$OutputDirectory = $PSScriptRoot
)

$ErrorActionPreference = 'Continue'
$lighthouse = 'C:\Users\marco\AppData\Local\Temp\taba2-perf-lighthouse-13.4.1\node_modules\.bin\lighthouse.cmd'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$url = 'https://taba2-staging.pages.dev/'
$runs = @(
  @{ Width = 390; Height = 844; Count = 5 },
  @{ Width = 320; Height = 568; Count = 3 }
)

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$statusRows = @()

foreach ($profile in $runs) {
  for ($run = 1; $run -le $profile.Count; $run += 1) {
    $report = Join-Path $OutputDirectory ("lighthouse-{0}-run{1}.json" -f $profile.Width, $run)
    $log = Join-Path $OutputDirectory ("lighthouse-{0}-run{1}.log" -f $profile.Width, $run)

    if (Test-Path -LiteralPath $report) {
      $statusRows += [pscustomobject]@{
        Width = $profile.Width
        Height = $profile.Height
        Run = $run
        ExitCode = 'existing'
        Report = $report
      }
      continue
    }

    $tempProfileRoot = Join-Path $OutputDirectory ("tmp-lh-{0}-run{1}" -f $profile.Width, $run)
    New-Item -ItemType Directory -Force -Path $tempProfileRoot | Out-Null
    $env:TEMP = $tempProfileRoot
    $env:TMP = $tempProfileRoot

    & $lighthouse $url `
      --output=json `
      --output-path=$report `
      --only-categories=performance `
      --form-factor=mobile `
      --screenEmulation.mobile=true `
      --screenEmulation.width=$($profile.Width) `
      --screenEmulation.height=$($profile.Height) `
      --screenEmulation.deviceScaleFactor=3 `
      --throttling-method=simulate `
      --chrome-path=$chrome `
      --chrome-flags='--headless=new --no-sandbox --disable-gpu' `
      --quiet *>&1 | Set-Content -LiteralPath $log -Encoding utf8

    $statusRows += [pscustomobject]@{
      Width = $profile.Width
      Height = $profile.Height
      Run = $run
      ExitCode = $LASTEXITCODE
      Report = $report
    }
  }
}

$statusRows | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'lighthouse-run-status.csv') -NoTypeInformation -Encoding utf8
$statusRows | Format-Table -AutoSize
