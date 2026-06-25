@echo off
chcp 65001 >nul
title Horrorgeticon Ops  -  DEMO
cd /d "%~dp0"
echo.
echo   HORRORGETICON OPS  -  DEMO-MODUS
echo.
echo   Startet mit dem vorbereiteten Demo-Szenario (eigene Demo-Daten,
echo   getrennt von echten Event-Daten). Ideal fuer Vorfuehrung/Pitch.
echo.
echo   Dieses Fenster offen lassen. Der Browser oeffnet automatisch.
echo.
node.exe server\main.js --demo --open --data demo-data
echo.
echo   Demo beendet. Fenster kann geschlossen werden.
pause >nul
