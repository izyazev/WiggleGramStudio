$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "This helper is intended for Windows."
}

$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($architecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
  throw "The automatic FFmpeg download currently supports 64-bit Windows (x64) only."
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporaryRoot = Join-Path $temporaryBase ("wigglegram-ffmpeg-" + [guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $temporaryRoot "ffmpeg.zip"
$extractPath = Join-Path $temporaryRoot "extracted"

try {
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  $headers = @{ "User-Agent" = "WiggleGramStudio-FFmpeg-Setup" }
  $release = Invoke-RestMethod -UseBasicParsing -Headers $headers -Uri "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -eq "ffmpeg-master-latest-win64-gpl.zip" } | Select-Object -First 1
  if (-not $asset) {
    throw "The expected 64-bit Windows FFmpeg archive was not found in the latest BtbN release."
  }

  Write-Output "Downloading $($asset.name)..."
  Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri $asset.browser_download_url -OutFile $archivePath
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  $ffmpeg = Get-ChildItem -LiteralPath $extractPath -Recurse -Filter "ffmpeg.exe" |
    Where-Object { $_.FullName -match "[\\/]bin[\\/]ffmpeg\.exe$" } |
    Select-Object -First 1
  if (-not $ffmpeg) {
    throw "ffmpeg.exe was not found in the downloaded archive."
  }

  Push-Location $repositoryRoot
  try {
    & node "scripts/link-ffmpeg.mjs" $ffmpeg.FullName
    if ($LASTEXITCODE -ne 0) { throw "Failed to prepare the FFmpeg sidecar." }
  }
  finally {
    Pop-Location
  }
}
finally {
  $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
  if (
    (Test-Path -LiteralPath $resolvedTemporaryRoot) -and
    $resolvedTemporaryRoot.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
  }
}
