@echo off
title Pusat Informasi Kegiatan Gereja - Server Lokal
cd /d "%~dp0"
if not exist node_modules (
  echo Menginstal dependensi...
  call npm install
)
echo Memulai server lokal...
echo.
echo Buka http://localhost:3000 di browser
node server/index.js
pause