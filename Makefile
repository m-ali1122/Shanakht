# Unix-ish Makefile. On Windows use scripts/dev.ps1 (same targets).
PY ?= .venv/Scripts/python.exe

.PHONY: up seed seed-graph dev reset test

up:
	docker compose up -d neo4j
	cd chain && npx hardhat node > ../chain-node.log 2>&1 &

seed:
	$(PY) data/generator/generate.py
	$(MAKE) seed-graph
	cd chain && npm run deploy
	curl -s -X POST http://localhost:8103/integrity/commit

seed-graph:
	$(PY) data/neo4j/load.py

dev:
	$(PY) -m uvicorn --app-dir services/banks main:app --port 8101 &
	$(PY) -m uvicorn --app-dir services/resolver main:app --port 8102 &
	$(PY) -m uvicorn --app-dir services/agent main:app --port 8103 &
	cd chain && npm run explorer &
	cd apps/web && npm run dev

reset:
	curl -s -X POST http://localhost:8103/demo/reset

test:
	$(PY) -m pytest services/agent/tests -q
