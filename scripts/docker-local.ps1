param([string]$BackupFile = '')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker не найден. Откройте Docker и повторите команду.' }
function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw 'Команда Docker завершилась с ошибкой; запуск остановлен.' }
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Откройте Docker на ноутбуке и дождитесь его запуска.' }
Invoke-Docker compose version
Invoke-Docker volume create octane-research-studio_studio-data
$DataExists = 'process.stdout.write(String(require("node:fs").existsSync("/data/studio.sqlite")))' | & docker run --rm -i --mount 'type=volume,src=octane-research-studio_studio-data,dst=/data' node:24-bookworm-slim node
if ($LASTEXITCODE -ne 0) { throw 'Не удалось проверить локальную базу.' }
if (-not $BackupFile) {
    $Candidates = @((Join-Path (Get-Location).Path 'octane-local-backup.enc.json'), (Join-Path $HOME 'Downloads/octane-local-backup.enc.json'))
    foreach ($Candidate in $Candidates) { if (Test-Path -LiteralPath $Candidate) { $BackupFile = $Candidate; break } }
}
$ProjectMount = "type=bind,src=$((Get-Location).Path),dst=/workspace"
if ($BackupFile) {
    $BackupFile = (Resolve-Path -LiteralPath $BackupFile).Path
    if ($DataExists.Trim() -eq 'false') {
        Invoke-Docker run --rm -it --mount $ProjectMount --mount 'type=volume,src=octane-research-studio_studio-data,dst=/workspace/.data' --mount "type=bind,src=$BackupFile,dst=/backup.enc,readonly" --workdir /workspace -e STUDIO_DOCKER_RESTORE=1 node:24-bookworm-slim node scripts/data-backup.mjs import /backup.enc
        $DataExists = 'true'
    } else { Write-Host 'Локальная база уже есть; существующие данные сохранены.' }
}
$SetupOptions = @('--docker-local')
if ($DataExists.Trim() -eq 'true') { $SetupOptions += '--existing-data' }
Invoke-Docker run --rm -it --mount $ProjectMount --workdir /workspace -e "STUDIO_PORT=$env:STUDIO_PORT" node:24-bookworm-slim node scripts/setup.mjs @SetupOptions
Invoke-Docker compose --project-name octane-research-studio up -d --build --wait --wait-timeout 120
Write-Host 'Приложение запущено. Откройте адрес PUBLIC_URL из настройки выше.'
