param([switch]$ValidateOnly, [string]$Destination, [switch]$SkipShortcut)
$ErrorActionPreference = 'Stop'
$beatVersion = '@VERSION@'
$beatPayload = Join-Path $PSScriptRoot 'BEAT-Windows.zip'
$beatExpectedHash = '@HASH@'
if (!(Test-Path -LiteralPath $beatPayload)) { throw 'Installer payload is missing. Keep all installer files together.' }
$beatHashAlgorithm = [Security.Cryptography.SHA256]::Create()
$beatPayloadStream = [IO.File]::OpenRead($beatPayload)
try { $beatActualHash = [BitConverter]::ToString($beatHashAlgorithm.ComputeHash($beatPayloadStream)).Replace('-','') }
finally { $beatPayloadStream.Dispose(); $beatHashAlgorithm.Dispose() }
if ($beatActualHash -ne $beatExpectedHash) { throw 'Installer payload failed its SHA-256 check.' }
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
$beatArchive = [System.IO.Compression.ZipFile]::OpenRead($beatPayload)
try {
    foreach ($beatEntry in $beatArchive.Entries) {
        $beatEntryName = $beatEntry.FullName.Replace('\','/')
        if (!$beatEntryName.StartsWith('BEAT Windows-win32-x64/') -or $beatEntryName.Split('/') -contains '..' -or $beatEntryName.Contains(':')) { throw 'Unsafe installer archive entry.' }
    }
} finally { $beatArchive.Dispose() }
if ($ValidateOnly) { Write-Output "Validated unsigned BEAT Windows $beatVersion installer payload."; return }
if (![Environment]::Is64BitOperatingSystem) { throw 'BEAT Windows requires 64-bit Windows.' }
$beatInstallRoot = [IO.Path]::GetFullPath($(if ($Destination) { $Destination } else { Join-Path $env:LOCALAPPDATA 'Programs\BEAT Windows' }))
function Assert-BeatChild([string]$candidate) {
    $resolved = [IO.Path]::GetFullPath($candidate)
    if (!$resolved.StartsWith($beatInstallRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Installer target is outside the application directory.' }
    return $resolved
}
$beatVersionRoot = Assert-BeatChild (Join-Path $beatInstallRoot "versions\$beatVersion")
if (Test-Path -LiteralPath $beatVersionRoot) { throw "Version $beatVersion is already installed. Use the BEAT Windows shortcut." }
$beatStaging = Assert-BeatChild (Join-Path $beatInstallRoot ('staging-' + [Guid]::NewGuid()))
try {
    New-Item -ItemType Directory -Path $beatStaging -Force | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($beatPayload,$beatStaging)
    $beatExtracted = Assert-BeatChild (Join-Path $beatStaging 'BEAT Windows-win32-x64')
    if (!(Test-Path -LiteralPath (Join-Path $beatExtracted 'BEAT Windows.exe'))) { throw 'The extracted application is incomplete.' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $beatVersionRoot) -Force | Out-Null
    Move-Item -LiteralPath $beatExtracted -Destination $beatVersionRoot
    $beatLaunchPath = Assert-BeatChild (Join-Path $beatInstallRoot 'Launch BEAT Windows.cmd')
    $beatLaunch = @"
@echo off
setlocal
set "BEAT_SMOKE_TEST="
set "BEAT_USER_DATA=%~dp0user-data"
set "BEAT_BRIDGE_FILE=%~dp0codex-bridge.json"
cd /d "%~dp0versions\$beatVersion"
icacls "%~dp0versions\$beatVersion" /grant "*S-1-15-2-1:(OI)(CI)(RX)" >nul
if errorlevel 1 exit /b 1
start "" "BEAT Windows.exe"
"@
    [IO.File]::WriteAllText($beatLaunchPath,$beatLaunch.Replace("`r`n","`n").Replace("`n","`r`n"),[Text.Encoding]::ASCII)
    $beatShortcutPath = $null
    if (!$SkipShortcut) {
        $beatShell = New-Object -ComObject WScript.Shell
        $beatShortcutPath = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\BEAT Windows.lnk'
        $beatShortcut = $beatShell.CreateShortcut($beatShortcutPath)
        $beatShortcut.TargetPath = $beatLaunchPath; $beatShortcut.WorkingDirectory = $beatInstallRoot
        $beatShortcut.IconLocation = Join-Path $beatVersionRoot 'BEAT Windows.exe'; $beatShortcut.Save()
    }
    @{ root = $beatInstallRoot; version = $beatVersion; shortcut = $beatShortcutPath } | ConvertTo-Json | Set-Content -LiteralPath (Assert-BeatChild (Join-Path $beatInstallRoot 'installation.json')) -Encoding UTF8
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Uninstall.ps1') -Destination (Assert-BeatChild (Join-Path $beatInstallRoot 'Uninstall.ps1'))
    $beatUninstallCommand = '@echo off' + "`r`n" + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall.ps1"' + "`r`n" + 'pause' + "`r`n"
    [IO.File]::WriteAllText((Assert-BeatChild (Join-Path $beatInstallRoot 'Uninstall BEAT Windows.cmd')),$beatUninstallCommand,[Text.Encoding]::ASCII)
    Write-Output "Installed unsigned BEAT Windows $beatVersion. Use the installed launcher or Start menu shortcut."
    Write-Output 'Older application versions and user data have been retained.'
} finally {
    $beatCheckedStaging = Assert-BeatChild $beatStaging
    if (Test-Path -LiteralPath $beatCheckedStaging) { Remove-Item -LiteralPath $beatCheckedStaging -Recurse -Force }
}
