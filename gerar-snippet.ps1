# Gera snipet.local.js (ignorado pelo git) a partir de snipet.js + .env
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $raiz '.env'
if (-not (Test-Path $envPath)) { Write-Error 'Arquivo .env não encontrado. Copie .env.example para .env e preencha.'; exit 1 }

$cfg = @{}
foreach ($linha in [IO.File]::ReadAllLines($envPath, [Text.Encoding]::UTF8)) {
  if ($linha -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $cfg[$Matches[1]] = $Matches[2].Trim('"', "'") }
}
foreach ($k in 'WEBAPP_URL', 'TOKEN') {
  if (-not $cfg[$k]) { Write-Error "Variável $k vazia ou ausente no .env"; exit 1 }
}

$src = [IO.File]::ReadAllText((Join-Path $raiz 'snipet.js'), [Text.Encoding]::UTF8)
$out = $src.Replace('__WEBAPP_URL__', $cfg['WEBAPP_URL']).Replace('__TOKEN__', $cfg['TOKEN'])
$destino = Join-Path $raiz 'snipet.local.js'
[IO.File]::WriteAllText($destino, $out, (New-Object Text.UTF8Encoding($false)))
Write-Host "Gerado: $destino"
