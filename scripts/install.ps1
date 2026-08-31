# Vibisual installer for Windows.
#
#   irm https://raw.githubusercontent.com/Vibisual/vibisual/main/scripts/install.ps1 | iex
#
# Environment:
#   $env:VIBISUAL_VERSION = 'v0.1.14'   install a specific tag instead of the latest
#
# The script downloads a published release asset over HTTPS from GitHub and runs
# the NSIS installer silently. It never builds from source.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'Vibisual/vibisual'
$api = "https://api.github.com/repos/$repo/releases"

# GitHub rejects requests without a user agent.
$headers = @{ 'User-Agent' = 'vibisual-install'; 'Accept' = 'application/vnd.github+json' }

Write-Host ''
try {
    $release = if ($env:VIBISUAL_VERSION) {
        Invoke-RestMethod -Uri "$api/tags/$($env:VIBISUAL_VERSION)" -Headers $headers
    } else {
        Invoke-RestMethod -Uri "$api/latest" -Headers $headers
    }
} catch {
    throw "Could not read the release list from GitHub: $($_.Exception.Message)"
}

$asset = $release.assets | Where-Object { $_.name -like '*-setup.exe' } | Select-Object -First 1
if (-not $asset) {
    throw "Release $($release.tag_name) has no Windows installer."
}

Write-Host "Vibisual $($release.tag_name)"
Write-Host ''
Write-Host "  downloading $($asset.name)"

$dest = Join-Path ([System.IO.Path]::GetTempPath()) $asset.name
$progress = $ProgressPreference
# Invoke-WebRequest's progress bar makes large downloads crawl in some hosts.
$ProgressPreference = 'SilentlyContinue'
try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -Headers $headers
} finally {
    $ProgressPreference = $progress
}

Write-Host '  installing (this takes a moment and needs no answers)'
$proc = Start-Process -FilePath $dest -ArgumentList '/S' -Wait -PassThru
Remove-Item $dest -Force -ErrorAction SilentlyContinue

if ($proc.ExitCode -ne 0) {
    throw "The installer exited with code $($proc.ExitCode)."
}

Write-Host ''
Write-Host 'Installed. Vibisual launches on its own; afterwards it is in the Start menu.'
Write-Host ''
Write-Host 'Vibisual runs on top of the Claude CLI, which must be installed separately'
Write-Host 'and available on your PATH: https://claude.com/claude-code'
