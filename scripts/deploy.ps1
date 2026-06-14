# deploy.ps1 — run from your LOCAL machine (Windows) to deploy to the Oracle server.
#
# What it does:
#   1. (optional) pushes your committed local main to GitHub if you pass -Push
#   2. SSHes into the server and runs scripts/deploy.sh there
#      (git reset --hard origin/main -> yarn install -> build -> migrate -> pm2 restart -> health check)
#
# Usage (from the repo root):
#   ./scripts/deploy.ps1            # deploy whatever is on origin/main
#   ./scripts/deploy.ps1 -Push      # push local commits first, then deploy
#
# Prereqs: the SSH key for ubuntu@<server> is already configured on this machine
# (it is — `ssh ubuntu@140.245.194.161` works without a password).

param(
    [switch]$Push,
    [string]$Server = "ubuntu@140.245.194.161",
    [string]$AppDir = "~/Dropped_Backend"
)

$ErrorActionPreference = "Stop"

if ($Push) {
    Write-Host "=== pushing local main to origin ===" -ForegroundColor Cyan
    git push origin main
}

Write-Host "=== deploying on $Server ===" -ForegroundColor Cyan
# Run the server-side script. It pulls origin/main itself, so the server always
# matches GitHub regardless of what's local here.
ssh -o ConnectTimeout=20 $Server "cd $AppDir && bash scripts/deploy.sh"

Write-Host ""
Write-Host "=== public health check (https://droppeddev.duckdns.org) ===" -ForegroundColor Cyan
ssh -o ConnectTimeout=20 $Server "curl -s https://droppeddev.duckdns.org/health"
Write-Host ""
Write-Host "Done. API: https://droppeddev.duckdns.org  |  Docs: https://droppeddev.duckdns.org/docs" -ForegroundColor Green
