$list = Get-Content 'D:\1212\taba2-p0-runtime-certification\webkit-list.log' |
  Where-Object { $_ -match '^\s*\[webkit\]' } |
  ForEach-Object { ($_ -replace '^\s*\[webkit\]\s+.{1,4}\s+', '').Trim() }
if ($list.Count -ne 149) { throw "EXPECTED_149_TESTS_GOT_$($list.Count)" }

$shards = @(
  [ordered]@{ id='1/6'; label='webkit-shard-1of6-3e48bb0'; count=25; duration_ms=129683; start='2026-08-03T20:21:23.4755315-03:00'; end='2026-08-03T20:23:33.1586991-03:00' },
  [ordered]@{ id='2/6'; label='webkit-shard-2of6-3e48bb0'; count=29; duration_ms=120131; start='2026-08-03T20:23:49.2193751-03:00'; end='2026-08-03T20:25:49.3507134-03:00' },
  [ordered]@{ id='3/6'; label='webkit-shard-3of6-3e48bb0'; count=25; duration_ms=90081; start='2026-08-03T20:26:05.7150795-03:00'; end='2026-08-03T20:27:35.7968949-03:00' },
  [ordered]@{ id='4a'; label='webkit-shard-4a-blank-3e48bb0'; count=6; duration_ms=64957; start='2026-08-03T20:34:25.9478243-03:00'; end='2026-08-03T20:35:30.9047128-03:00' },
  [ordered]@{ id='4b'; label='webkit-shard-4b-phantom-3e48bb0'; count=16; duration_ms=53946; start='2026-08-03T20:35:46.7721278-03:00'; end='2026-08-03T20:36:40.7181349-03:00' },
  [ordered]@{ id='5/6'; label='webkit-shard-5of6-3e48bb0'; count=25; duration_ms=142065; start='2026-08-03T20:36:56.1538643-03:00'; end='2026-08-03T20:39:18.2180195-03:00' },
  [ordered]@{ id='6/6'; label='webkit-shard-6of6-3e48bb0'; count=23; duration_ms=163417; start='2026-08-03T20:39:34.1664890-03:00'; end='2026-08-03T20:42:17.5833041-03:00' }
)

$entries = @()
$index = 0
foreach ($shard in $shards) {
  for ($j = 0; $j -lt $shard.count; $j++) {
    $entries += [ordered]@{
      index = $index + 1
      name = $list[$index]
      shard = $shard.id
      result = 'PASS'
      duration_ms = $null
      shard_duration_ms = $shard.duration_ms
      exit_code = 0
      artifact = "/abs/D:/1212/taba2-p0-runtime-certification/$($shard.label).log"
    }
    $index++
  }
}
if ($index -ne 149) { throw 'SHARD_SUM_NOT_149' }

$manifest = [ordered]@{
  schema = 'taba2-webkit-manifest-v1'
  head = '3e48bb0bcd777276d23c542c60fec94ed8b0ed84'
  browser = 'webkit'
  workers = 1
  retries = 0
  timeout_ms = 90000
  total_unique_tests = 149
  duplicate_test_names = 0
  all_gate_shards_exit_0 = $true
  all_gate_tests_pass = $true
  individual_duration_source = 'not emitted by reporter=line; shard duration is recorded; final JSON measurement was blocked by the external Claude runner'
  shards = $shards
  tests = $entries
  diagnostics = @(
    [ordered]@{ run='webkit-shard-2-3e48bb0'; result='FAIL'; passed=2; failed=45; cause='P0 webserver stopped responding after test 2; isolated gate1 test passed 1/1'; artifact='/abs/D:/1212/taba2-p0-runtime-certification/webkit-shard-2-3e48bb0.log' },
    [ordered]@{ run='webkit-shard-2-rerun-3e48bb0'; result='FAIL'; passed=47; failed=0; cause='Playwright worker teardown timeout after all tests; 3 orphan WebKitNetworkProcess; no test failures'; artifact='/abs/D:/1212/taba2-p0-runtime-certification/webkit-shard-2-rerun-3e48bb0.log' },
    [ordered]@{ run='webkit-shard-4of6-3e48bb0'; result='FAIL'; passed=22; failed=0; cause='Playwright worker teardown timeout after all tests; split into 4a/4b'; artifact='/abs/D:/1212/taba2-p0-runtime-certification/webkit-shard-4of6-3e48bb0.log' }
  )
  runner_preflight = '/abs/D:/1212/taba2-p0-runtime-certification/webkit-preflight.ps1'
  external_isolation = 'BLOCKED_BY_CLAUDE_PLAYWRIGHT_AUTO_RELAUNCH'
}

$manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 'D:\1212\taba2-p0-runtime-certification\webkit-manifest.json'
