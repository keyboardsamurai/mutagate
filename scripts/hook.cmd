@echo off
setlocal
set "N=%MUTAGATE_NODE%"
if not defined N if exist "%~dp0.node-path" set /p N=<"%~dp0.node-path"
if not defined N set "N=node"
"%N%" "%~dp0mutagate-hook.cjs" hook %*
