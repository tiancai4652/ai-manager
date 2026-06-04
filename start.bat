@echo off
chcp 65001 >nul 2>&1
title CCreminde 提醒助手

:: ──────────────────────────────────────────
::  命令行参数模式（静默执行）
:: ──────────────────────────────────────────
if "%~1"=="/background" goto run_background_silent
if "%~1"=="/autostart" goto set_autostart_silent

:: ──────────────────────────────────────────
::  交互式菜单
:: ──────────────────────────────────────────
:menu
cls
echo.
echo   ══════════════════════════════════════
echo     CCreminde 提醒助手 - 启动菜单
echo   ══════════════════════════════════════
echo.
echo     [1] 后台运行 (最小化到系统托盘)
echo     [2] 前台运行 (命令行模式)
echo     [3] 设置开机自启动
echo     [4] 取消开机自启动
echo     [0] 退出
echo.
echo   ──────────────────────────────────────
echo     当前状态:
echo.

:: 检查是否已设置开机自启动
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_NAME=CCreminder.lnk"
if exist "%STARTUP_DIR%\%SHORTCUT_NAME%" (
    echo     开机自启动: 已启用
) else (
    echo     开机自启动: 未启用
)

echo.
set /p choice="  请选择 [0-4]: "

if "%choice%"=="1" goto run_background
if "%choice%"=="2" goto run_foreground
if "%choice%"=="3" goto set_autostart
if "%choice%"=="4" goto remove_autostart
if "%choice%"=="0" goto end
goto menu

:: ──────────────────────────────────────────
::  后台运行 (交互式)
:: ──────────────────────────────────────────
:run_background
echo.
echo   正在启动后台服务...
echo   关闭此窗口不会影响托盘运行。
echo.
start "CCreminder Tray" /B node "%~dp0dist\index.js" --tray >nul 2>&1
echo   提醒助手已在后台启动!
echo   请查看系统托盘图标。
echo.
pause
goto menu

:: ──────────────────────────────────────────
::  后台运行 (命令行参数 /background，静默)
:: ──────────────────────────────────────────
:run_background_silent
start "CCreminder Tray" /B node "%~dp0dist\index.js" --tray >nul 2>&1
exit /b 0

:: ──────────────────────────────────────────
::  前台运行 (命令行模式)
:: ──────────────────────────────────────────
:run_foreground
echo.
echo   正在启动前台服务...
echo   按 Ctrl+C 可停止服务。
echo.
node "%~dp0dist\index.js" --tray
pause
goto menu

:: ──────────────────────────────────────────
::  设置开机自启动 (交互式)
:: ──────────────────────────────────────────
:set_autostart
echo.
echo   正在设置开机自启动...
call :create_shortcut
if exist "%STARTUP_DIR%\%SHORTCUT_NAME%" (
    echo   开机自启动已设置成功!
) else (
    echo   设置失败，请手动创建快捷方式到:
    echo   %STARTUP_DIR%
)
echo.
pause
goto menu

:: ──────────────────────────────────────────
::  设置开机自启动 (命令行参数 /autostart，静默)
:: ──────────────────────────────────────────
:set_autostart_silent
call :create_shortcut
exit /b 0

:: ──────────────────────────────────────────
::  取消开机自启动
:: ──────────────────────────────────────────
:remove_autostart
echo.
if exist "%STARTUP_DIR%\%SHORTCUT_NAME%" (
    del /f "%STARTUP_DIR%\%SHORTCUT_NAME%" >nul 2>&1
    echo   已取消开机自启动。
) else (
    echo   当前未设置开机自启动。
)
echo.
pause
goto menu

:: ──────────────────────────────────────────
::  子程序: 创建启动文件夹快捷方式
:: ──────────────────────────────────────────
:create_shortcut
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_NAME=CCreminder.lnk"
set "VBS_FILE=%TEMP%\create_shortcut_%RANDOM%.vbs"
set "BAT_PATH=%~dp0start.bat"
set "ICON_PATH=%~dp0assets\icon.ico"

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS_FILE%"
echo sLinkFile = "%STARTUP_DIR%\%SHORTCUT_NAME%" >> "%VBS_FILE%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS_FILE%"
echo oLink.TargetPath = "%BAT_PATH%" >> "%VBS_FILE%"
echo oLink.WorkingDirectory = "%~dp0" >> "%VBS_FILE%"
echo oLink.Description = "CCreminder 提醒助手" >> "%VBS_FILE%"
echo oLink.Arguments = "/background" >> "%VBS_FILE%"
echo oLink.IconLocation = "%ICON_PATH%,0" >> "%VBS_FILE%"
echo oLink.Save >> "%VBS_FILE%"

cscript /nologo "%VBS_FILE%" >nul 2>&1
del /f "%VBS_FILE%" >nul 2>&1
goto :eof

:end
exit /b 0
