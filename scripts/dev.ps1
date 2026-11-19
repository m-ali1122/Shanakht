# Windows equivalent of the Makefile.  Usage: .\scripts\dev.ps1 up|seed|seed-graph|dev|reset|test
param([Parameter(Mandatory=$true)][ValidateSet("up","seed","seed-graph","dev","reset","test")][string]$Target)
$Root = Split-Path -Parent $PSScriptRoot
$Py = Join-Path $Root ".venv\Scripts\python.exe"
Set-Location $Root

function Up {
  docker compose up -d neo4j
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$Root\chain'; npx hardhat node"
}
function SeedGraph { & $Py data\neo4j\load.py }
function Seed {
  & $Py data\generator\generate.py
  SeedGraph
  Push-Location chain; npm run deploy; Pop-Location
  Invoke-RestMethod -Method Post http://localhost:8103/integrity/commit
}
function Dev {
  foreach ($s in @(@("banks",8101),@("resolver",8102),@("agent",8103))) {
    Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$Root'; & '$Py' -m uvicorn --app-dir services\$($s[0]) main:app --port $($s[1])"
  }
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$Root\chain'; npm run explorer"
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$Root\apps\web'; npm run dev"
}
function Reset { Invoke-RestMethod -Method Post http://localhost:8103/demo/reset }
function Test { & $Py -m pytest services\agent\tests services\resolver\tests services\banks\tests data\neo4j\tests data\generator\tests -q }
esolver	ests servicesbanks	ests data
eo4j	ests datagenerator	ests -q }

switch ($Target) {
  "up" { Up } "seed" { Seed } "seed-graph" { SeedGraph } "dev" { Dev } "reset" { Reset } "test" { Test }
}
