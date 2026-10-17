param([string]$Executable = "$PSScriptRoot/../native/src-tauri/target/release/chinaslop-tracker.exe")
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('chinaslop-smoke-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot | Out-Null
if (Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 4318 is in use. Close the tracker before running this test.' }
$originalAppData = $env:APPDATA
try {
    $env:APPDATA = $testRoot
    $appProcess = Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $testRoot 'stderr.log')
} finally { $env:APPDATA = $originalAppData }
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        $appProcess.Refresh()
        if ($appProcess.HasExited) { throw "App exited with code $($appProcess.ExitCode)" }
        try {
            $response = Invoke-WebRequest -Uri http://127.0.0.1:4318/api/state -SkipHttpErrorCheck -TimeoutSec 1
            if ($response.StatusCode -eq 403 -and $appProcess.MainWindowHandle -ne 0) { $ready = $true; break }
        } catch { }
    }
    if (-not $ready) { throw 'App window and protected local API did not become ready.' }
    "PASS: window '$($appProcess.MainWindowTitle)' opened and unauthenticated API access returned HTTP 403."
} finally {
    if (-not $appProcess.HasExited) {
        $null = $appProcess.CloseMainWindow()
        if (-not $appProcess.WaitForExit(5000)) { Stop-Process -Id $appProcess.Id }
    }
    Get-Content (Join-Path $testRoot 'stderr.log')
    "Isolated smoke-test logs: $testRoot"
}
