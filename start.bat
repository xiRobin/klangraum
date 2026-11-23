@echo off
rem Startet Klangraum lokal auf http://127.0.0.1:8888/
cd /d "%~dp0"
echo Klangraum laeuft auf http://127.0.0.1:8888/  (Fenster schliessen zum Beenden)
start "" "http://127.0.0.1:8888/"
python -m http.server 8888 --bind 127.0.0.1
