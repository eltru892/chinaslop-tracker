@echo off
setlocal
cd /d "%~dp0"
where cargo >nul 2>nul
if errorlevel 1 (
  echo Install Rust from https://rustup.rs/ and reopen this launcher.
  pause
  exit /b 1
)
cargo build --locked --release
if errorlevel 1 (
  echo Build failed. Check the compiler messages above.
  pause
  exit /b 1
)
if not exist "artifacts\windows" mkdir "artifacts\windows"
copy /y "target\release\chinaslop-tracker-windows.exe" "artifacts\windows\Chinaslop Tracker.exe" >nul
if errorlevel 1 exit /b 1
xcopy "assets" "artifacts\windows\assets\" /e /i /y >nul
if errorlevel 1 exit /b 1
copy /y "ATTRIBUTION.md" "artifacts\windows\ATTRIBUTION.md" >nul
echo Build ready in artifacts\windows.
pause
