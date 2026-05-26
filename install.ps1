#Requires -Version 5.1

$ErrorActionPreference = "Stop"

$Repo = "mitchell-wallace/linesman"
$ToolName = "linesman"
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\$ToolName"

$Version = if ($args.Length -gt 0) { $args[0] } elseif ($env:LINESMAN_VERSION) { $env:LINESMAN_VERSION } else { "" }
$Version = $Version -replace '^v',''

if (-not $Version) {
    $LatestUrl = "https://api.github.com/repos/$Repo/releases/latest"
    $Release = Invoke-RestMethod -Uri $LatestUrl -UseBasicParsing
    $Tag = $Release.tag_name
    if (-not $Tag) {
        Write-Error "Failed to fetch latest release tag"
        exit 1
    }
    $Version = $Tag -replace '^v',''
}

$Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { "x64" }
    "ARM64" { "arm64" }
    default {
        Write-Error "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE"
        exit 1
    }
}

$Asset = "${ToolName}_${Version}_win_${Arch}.zip"
$DownloadUrl = "https://github.com/$Repo/releases/download/v$Version/$Asset"
$TempFile = Join-Path $env:TEMP $Asset

Write-Host "Installing $ToolName v$Version for Windows..."
Write-Host "Downloading $Asset..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempFile -UseBasicParsing

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Expand-Archive -Path $TempFile -DestinationPath $InstallDir -Force
Remove-Item -Path $TempFile -Force

$ExePath = Get-ChildItem -Path $InstallDir -Filter "${ToolName}.exe" -Recurse | Select-Object -First 1
if (-not $ExePath) {
    $ExePath = Get-ChildItem -Path $InstallDir -Filter "*.exe" -Recurse | Select-Object -First 1
}

if ($ExePath) {
    Write-Host "Installed to $($ExePath.FullName)"
} else {
    Write-Host "Extracted to $InstallDir"
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = "$UserPath;$InstallDir"
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    Write-Host "Added $InstallDir to user PATH"
} else {
    Write-Host "$InstallDir already in user PATH"
}

Write-Host ""
Write-Host "Installation complete. Restart your terminal to use $ToolName."
Write-Host "Note: On first launch, Windows SmartScreen may show a warning (unsigned app)."
Write-Host 'Click "More info" -> "Run anyway" to proceed.'
Write-Host ""
Write-Host "Usage: cd your-project; $ToolName"
