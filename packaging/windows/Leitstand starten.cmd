@echo off
chcp 65001 >nul
title Horrorgeticon Ops  -  Leitstand
cd /d "%~dp0"
echo.
echo   ============================================================
echo     HORRORGETICON OPS  -  LEITSTAND
echo   ============================================================
echo.
echo   Der Leitstand startet jetzt. Der Browser oeffnet sich
echo   gleich von selbst.
echo.
echo   WICHTIG: Dieses schwarze Fenster waehrend des Events
echo   GEOEFFNET lassen - es IST der Leitstand-Server.
echo.
echo   Die Crew verbindet sich im selben WLAN. Adresse + QR-Code
echo   stehen im Anmeldebildschirm unter "Crew per QR verbinden".
echo.
echo   ------------------------------------------------------------
echo.
node.exe server\main.js --open
echo.
echo   Leitstand wurde beendet. Dieses Fenster kann geschlossen werden.
pause >nul
