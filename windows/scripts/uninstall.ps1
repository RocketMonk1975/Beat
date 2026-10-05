$ErrorActionPreference = 'Stop'
$beatInstallation = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installation.json') -Raw | ConvertFrom-Json
$beatInstallRoot = [IO.Path]::GetFullPath($PSScriptRoot)
if ($beatInstallation.root -ne $beatInstallRoot) { throw 'Run the installed uninstaller from the BEAT Windows application directory.' }
$beatVersions = [IO.Path]::GetFullPath((Join-Path $beatInstallRoot 'versions'))
if (!$beatVersions.StartsWith($beatInstallRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe uninstall target.' }
if (Get-Process -Name 'BEAT Windows' -ErrorAction SilentlyContinue) { throw 'Close BEAT Windows before uninstalling.' }
if (Test-Path -LiteralPath $beatVersions) { Remove-Item -LiteralPath $beatVersions -Recurse -Force }
$beatLauncher = Join-Path $beatInstallRoot 'Launch BEAT Windows.cmd'
if (Test-Path -LiteralPath $beatLauncher) { Remove-Item -LiteralPath $beatLauncher }
$beatShortcut = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\BEAT Windows.lnk'
if ($beatInstallation.shortcut -eq $beatShortcut -and (Test-Path -LiteralPath $beatShortcut)) { Remove-Item -LiteralPath $beatShortcut }
Write-Output 'BEAT Windows removed. User data and recovery drafts have been retained in the application directory.'
