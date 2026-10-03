$ErrorActionPreference = 'Stop'

$projectRef = 'yakhtrkukqlgzvxuvhzs'
$runtimeRoot = 'C:\1212\taba-device-test-runtime'
$sessionRoot = Join-Path $runtimeRoot 'rider-map-session'
$accessPath = Join-Path $runtimeRoot 'device-test-access.txt'
$resultPath = Join-Path $sessionRoot 'business-coordinate-authority.json'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class TabaCredentialReader
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL
    {
        public UInt32 Flags;
        public UInt32 Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr credentialPtr);

    public static byte[] ReadGenericBlob(string target)
    {
        IntPtr credentialPtr;
        if (!CredRead(target, 1, 0, out credentialPtr))
        {
            throw new InvalidOperationException("Supabase CLI credential is unavailable.");
        }
        try
        {
            CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(
                credentialPtr,
                typeof(CREDENTIAL)
            );
            byte[] blob = new byte[credential.CredentialBlobSize];
            if (blob.Length > 0)
            {
                Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
            }
            return blob;
        }
        finally
        {
            CredFree(credentialPtr);
        }
    }
}
'@

function Resolve-SupabaseAccessToken {
  $blob = [TabaCredentialReader]::ReadGenericBlob('Supabase CLI:supabase')
  $utf8 = [Text.Encoding]::UTF8.GetString($blob).Trim([char]0).Trim()
  $unicode = [Text.Encoding]::Unicode.GetString($blob).Trim([char]0).Trim()
  foreach ($candidate in @($utf8, $unicode)) {
    if ($candidate -match '^sbp_[A-Za-z0-9_-]{20,}$') {
      return $candidate
    }
  }
  throw 'Supabase CLI credential does not contain a usable Management API token.'
}

function Convert-ToNumber {
  param($Value)

  $number = 0.0
  $style = [Globalization.NumberStyles]::Float
  $culture = [Globalization.CultureInfo]::InvariantCulture
  if ([double]::TryParse([string]$Value, $style, $culture, [ref]$number)) {
    return $number
  }
  return $null
}

function Resolve-CoordinatePair {
  param($Latitude, $Longitude)

  $lat = Convert-ToNumber $Latitude
  $lng = Convert-ToNumber $Longitude
  if (
    $null -eq $lat -or
    $null -eq $lng -or
    $lat -lt -90 -or
    $lat -gt 90 -or
    $lng -lt -180 -or
    $lng -gt 180 -or
    ($lat -eq 0 -and $lng -eq 0)
  ) {
    return $null
  }
  return [ordered]@{ latitude = $lat; longitude = $lng }
}

function Resolve-Coordinates {
  param($Fields)

  if ($null -eq $Fields) {
    return $null
  }
  $pairs = @(
    @($Fields.latitude, $Fields.longitude),
    @($Fields.lat, $Fields.lng),
    @($Fields.business_latitude, $Fields.business_longitude),
    @($Fields.location.latitude, $Fields.location.longitude),
    @($Fields.location.lat, $Fields.location.lng),
    @($Fields.business_location.latitude, $Fields.business_location.longitude),
    @($Fields.business_location.lat, $Fields.business_location.lng)
  )
  foreach ($pair in $pairs) {
    $valid = Resolve-CoordinatePair -Latitude $pair[0] -Longitude $pair[1]
    if ($null -ne $valid) {
      return $valid
    }
  }
  return $null
}

function First-Row {
  param($Response)

  if ($Response -is [array]) {
    return @($Response) | Select-Object -First 1
  }
  if ($Response.data -is [array]) {
    return @($Response.data) | Select-Object -First 1
  }
  if ($Response.result -is [array]) {
    return @($Response.result) | Select-Object -First 1
  }
  return $Response
}

$accessText = [IO.File]::ReadAllText($accessPath)
$businessId = [regex]::Match(
  $accessText,
  '^Business ID:\s*([0-9a-f-]{36})\s*$',
  [Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
    [Text.RegularExpressions.RegexOptions]::Multiline
).Groups[1].Value
$parsedBusinessId = [Guid]::Empty
if (-not [Guid]::TryParse($businessId, [ref]$parsedBusinessId) -or $parsedBusinessId -eq [Guid]::Empty) {
  throw 'QA business ID is unavailable.'
}

$token = Resolve-SupabaseAccessToken
$query = @"
select
  exists(select 1 from public.businesses where id = '$businessId'::uuid) as business_found,
  has_table_privilege('anon', 'public.businesses', 'SELECT') as anon_business_select,
  has_table_privilege('authenticated', 'public.businesses', 'SELECT') as authenticated_business_select,
  (
    select jsonb_build_object(
      'latitude', to_jsonb(b)->'latitude',
      'longitude', to_jsonb(b)->'longitude',
      'lat', to_jsonb(b)->'lat',
      'lng', to_jsonb(b)->'lng',
      'business_latitude', to_jsonb(b)->'business_latitude',
      'business_longitude', to_jsonb(b)->'business_longitude',
      'location', to_jsonb(b)->'location',
      'business_location', to_jsonb(b)->'business_location'
    )
    from public.businesses b
    where b.id = '$businessId'::uuid
    limit 1
  ) as coordinate_fields,
  (
    select count(*)::integer
    from public.products p
    where p.business_id = '$businessId'::uuid
      and p.is_active = true
      and p.is_verified = true
  ) as verified_products,
  (
    select count(*)::integer
    from public.products p
    where p.business_id = '$businessId'::uuid
      and p.is_active = true
      and p.is_verified = true
      and nullif(p.image_url, '') is not null
      and nullif(p.image_thumbnail_url, '') is not null
      and p.image_sha256 ~ '^[a-f0-9]{64}$'
      and p.image_thumbnail_sha256 ~ '^[a-f0-9]{64}$'
      and p.source_image_sha256 ~ '^[a-f0-9]{64}$'
  ) as products_with_authoritative_photos;
"@

try {
  $response = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.supabase.com/v1/projects/$projectRef/database/query/read-only" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType 'application/json' `
    -Body (@{ query = $query; read_only = $true } | ConvertTo-Json -Compress) `
    -TimeoutSec 45
  $row = First-Row $response
  $coordinates = Resolve-Coordinates $row.coordinate_fields
  $verifiedProducts = [int]$row.verified_products
  $photoProducts = [int]$row.products_with_authoritative_photos
  $result = [ordered]@{
    managementReadOnly = 'yes'
    businessFound = $row.business_found -eq $true
    coordinates = if ($null -ne $coordinates) { 'available' } else { 'unavailable' }
    anonBusinessSelect = $row.anon_business_select -eq $true
    authenticatedBusinessSelect = $row.authenticated_business_select -eq $true
    verifiedProducts = $verifiedProducts
    productsWithAuthoritativePhotos = $photoProducts
  }
  [IO.File]::WriteAllText(
    $resultPath,
    ($result | ConvertTo-Json),
    [Text.UTF8Encoding]::new($false)
  )
  Write-Output 'management_read_only=yes'
  Write-Output "business_found=$($result.businessFound.ToString().ToLowerInvariant())"
  Write-Output "business_coordinates=$($result.coordinates)"
  Write-Output "anon_business_select=$($result.anonBusinessSelect.ToString().ToLowerInvariant())"
  Write-Output "authenticated_business_select=$($result.authenticatedBusinessSelect.ToString().ToLowerInvariant())"
  Write-Output "verified_products=$verifiedProducts"
  Write-Output "products_with_authoritative_photos=$photoProducts"
} finally {
  $token = $null
  $query = $null
}
