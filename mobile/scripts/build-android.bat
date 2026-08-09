@echo off
REM ========================================
REM NurChat Mobile Build Script
REM ========================================

echo [%time%] Starting NurChat Mobile Build...

REM Check Java
where java >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Java not found. Please install JDK 17.
    echo Download: https://adoptium.net/
    exit /b 1
)

REM Check Android SDK
if not defined ANDROID_HOME (
    echo [ERROR] ANDROID_HOME not set.
    echo Set it to: %%LOCALAPPDATA%%\Android\Sdk
    exit /b 1
)

REM Check Tauri CLI
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] cargo not found. Please install Rust.
    echo Download: https://rustup.rs/
    exit /b 1
)

echo [%time%] All prerequisites found.

REM Navigate to src-tauri
cd /d "%~dp0\..\src-tauri"

REM Check if Android is initialized
if not exist "gen\android" (
    echo [%time%] Android project not initialized. Initializing...
    cargo tauri android init
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to initialize Android project.
        exit /b 1
    )
)

echo [%time%] Building Android...

REM Build for Android
cargo tauri android build --target aab
if %errorlevel% neq 0 (
    echo [ERROR] Build failed.
    exit /b 1
)

echo [%time%] Build complete!
echo APK/AAB location: src-tauri\gen\android\app\build\outputs\

pause
