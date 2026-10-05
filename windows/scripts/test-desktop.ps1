$ErrorActionPreference = 'Stop'
$beatProject = Split-Path -Parent $PSScriptRoot
$beatExecutable = Join-Path $beatProject 'node_modules\electron\dist\electron.exe'
$beatPreviousLocation = Get-Location
try {
    Set-Location -LiteralPath $beatProject
    $env:BEAT_SMOKE_TEST = '1'
    $env:BEAT_USER_DATA = Join-Path $beatProject 'work\desktop-test\user-data'
    $env:BEAT_BRIDGE_FILE = Join-Path $beatProject 'work\desktop-test\codex-bridge.json'
    $beatProcess = Start-Process -FilePath $beatExecutable -ArgumentList '.' -WorkingDirectory $beatProject -WindowStyle Hidden -PassThru -Wait
    $beatResults = Join-Path $beatProject 'work\desktop-test\results.json'
    if (Test-Path -LiteralPath $beatResults) { Get-Content -LiteralPath $beatResults }
    if ($beatProcess.ExitCode -ne 0) { throw "Desktop tests exited with code $($beatProcess.ExitCode)." }
} finally {
    Remove-Item Env:BEAT_SMOKE_TEST,Env:BEAT_USER_DATA,Env:BEAT_BRIDGE_FILE -ErrorAction SilentlyContinue
    Set-Location -LiteralPath $beatPreviousLocation.Path
}
