@echo off
REM start-control-panel-debug.cmd
REM Debug launcher for WebAI LocalBridge.
REM Use this file when you need to see the console output for troubleshooting.
REM
REM For daily use, use start-control-panel-hidden.vbs instead (no console window).

setlocal enabledelayedexpansion
title WebAI LocalBridge

set "PROJECT_DIR=%~dp0"
for %%I in ("%PROJECT_DIR%.") do set "PROJECT_DIR=%%~fI"

if not exist "%PROJECT_DIR%\" (
    echo ERROR: Project directory not found: %PROJECT_DIR%
    pause
    exit /b 1
)

cd /d "%PROJECT_DIR%" || (
    echo ERROR: Failed to cd to %PROJECT_DIR%
    pause
    exit /b 1
)

echo Starting WebAI LocalBridge in DEBUG mode (console visible)...
echo Project dir: %PROJECT_DIR%
echo.

set "NODE_EXE=%PROJECT_DIR%\runtime\node\node.exe"
if exist "%NODE_EXE%" (
    echo Node runtime: %NODE_EXE%
    "%NODE_EXE%" control-panel-v2.js
) else (
    echo Node runtime: node from PATH
    node control-panel-v2.js
)
