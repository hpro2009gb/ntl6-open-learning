param(
  [Parameter(Position=0)]
  [string]$PackPath,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

if ([string]::IsNullOrWhiteSpace($PackPath)) {
  $PackPath = Join-Path $Repo "examples\manual-pack"
}

$resolved = (Resolve-Path $PackPath).Path
$packDir = $resolved

if (Test-Path -LiteralPath $resolved -PathType Leaf) {
  if ([IO.Path]::GetExtension($resolved).ToLowerInvariant() -ne ".zip") {
    throw "Pack input must be a directory or .zip: $resolved"
  }

  $inbox = Join-Path $Repo "runtime-data\inbox"
  New-Item -ItemType Directory -Force -Path $inbox | Out-Null
  $name = [IO.Path]::GetFileNameWithoutExtension($resolved)
  $dest = Join-Path $inbox ($name + "-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  Expand-Archive -LiteralPath $resolved -DestinationPath $dest -Force

  $manifests = @(Get-ChildItem -LiteralPath $dest -Recurse -File -Filter "manifest.json")
  if ($manifests.Count -ne 1) {
    throw "ZIP must contain exactly one manifest.json. Found: $($manifests.Count)"
  }
  $packDir = $manifests[0].Directory.FullName
}

$runner = Join-Path $Repo "tools\manual-mode\run.mjs"
$lines = @(& node $runner $packDir 2>&1)
$exit = $LASTEXITCODE
$lines | ForEach-Object { Write-Host $_ }
if ($exit -ne 0) { exit $exit }

$parentLine = $lines | Where-Object { $_ -like "PARENT_VIEW=*" } | Select-Object -Last 1
if ($parentLine) {
  $parentView = $parentLine.Substring("PARENT_VIEW=".Length)
  Write-Host ""
  Write-Host "NTL6 da xong. Bao cao phu huynh:" -ForegroundColor Green
  Write-Host $parentView
  if (-not $NoOpen) { Start-Process $parentView }
}
