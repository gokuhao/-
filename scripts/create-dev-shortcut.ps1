[CmdletBinding()]
param(
  [string]$DestinationDirectory = [Environment]::GetFolderPath("Desktop")
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $projectRoot "start-dev.bat"
$iconPath = Join-Path $projectRoot "build\icon.ico"

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  throw "StepBeast development launcher was not found: $launcherPath"
}

if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
  throw "StepBeast icon was not found: $iconPath"
}

if (-not (Test-Path -LiteralPath $DestinationDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
}

$shortcutName = (-join @(
  [char]0x6B65,
  [char]0x6B65,
  [char]0x517D,
  "-",
  [char]0x5F00,
  [char]0x53D1,
  [char]0x7248
)) + ".lnk"
$shortcutPath = Join-Path $DestinationDirectory $shortcutName
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Launch StepBeast local development mode"
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Output $shortcutPath
