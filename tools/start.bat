@echo off
rem Horrorgeticon Ops starten (Windows). Demo-Daten beim ersten Start: start.bat --demo
cd /d "%~dp0\.."
node server\main.js %*
