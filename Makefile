# Heritage Splitter — Makefile
# Usage: make help

.PHONY: help dev-setup dev-up dev-down dev-logs \
        build build-backend build-frontend build-contracts \
        test test-contracts test-backend \
        deploy-fuji deploy-mainnet verify-fuji \
        db-reset db-seed \
        ovh-init ovh-deploy ovh-build ovh-status ovh-logs ovh-db-reset ovh-shell \
        clean clean-all \
        fmt lint check

# ─── Config ──────────────────────────────────────────────────────────
SHELL       := /bin/bash
ROOT        := $(shell pwd)
BACKEND     := $(ROOT)/backend
FRONTEND    := $(ROOT)/frontend
BLOCKCHAIN  := $(ROOT)/blockchain

# Blockchain
CHAIN_FUJI  := 43113
CHAIN_MAIN  := 43114
RPC_FUJI    := https://api.avax-test.network/ext/bc/C/rpc
RPC_MAIN    := https://api.avax.network/ext/bc/C/rpc

# OVH Kubernetes
OVH_KUBECONFIG := $(ROOT)/kubeconfig-ah0t12.yml
OVH_REGISTRY   := 97ksui70.c1.gra9.container-registry.ovh.net
OVH_PROJECT    := heritage-splitter
OVH_NS         := heritage
OVH_KC         := KUBECONFIG=$(OVH_KUBECONFIG) kubectl

# ─── Help ────────────────────────────────────────────────────────────
help: ## Show this help
	@echo ""
	@echo "  Heritage Splitter — Commandes disponibles"
	@echo "  ──────────────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ─── Dev Environment (Tilt + K8s) ───────────────────────────────────
dev-setup: ## Setup complet: deps, BDD, build initial
	@echo "⏳ Installation des dépendances..."
	@$(MAKE) -s _deps-backend
	@$(MAKE) -s _deps-frontend
	@$(MAKE) -s _deps-contracts
	@$(MAKE) -s db-reset
	@echo ""
	@echo "✅ Setup terminé. Lance 'make dev-up' pour démarrer."

dev-up: ## Lancer l'env local avec Tilt (backend + frontend sur K8s)
	tilt up

dev-down: ## Arrêter Tilt
	tilt down

dev-logs: ## Voir les logs Tilt
	tilt logs -f

# ─── Dev local sans K8s (plus léger) ────────────────────────────────
dev-local: ## Lancer backend + frontend en local sans Docker/K8s
	@$(MAKE) -j2 _run-backend _run-frontend

_run-backend:
	@echo "🦀 Backend sur http://localhost:3001"
	@cd $(BACKEND) && cargo run

_run-frontend:
	@echo "⚡ Frontend sur http://localhost:3000"
	@cd $(FRONTEND) && pnpm dev

# ─── Build ───────────────────────────────────────────────────────────
build: build-contracts build-backend build-frontend ## Build tout

build-backend: ## Build le backend Rust (release)
	cd $(BACKEND) && cargo build --release

build-frontend: ## Build le frontend (production)
	cd $(FRONTEND) && pnpm build

build-contracts: ## Compiler les smart contracts
	cd $(BLOCKCHAIN) && forge build

# ─── Test ────────────────────────────────────────────────────────────
test: test-contracts test-backend ## Lancer tous les tests

test-contracts: ## Tests smart contracts (Foundry)
	cd $(BLOCKCHAIN) && forge test -vv

test-backend: ## Tests backend Rust
	cd $(BACKEND) && cargo test

test-coverage: ## Coverage smart contracts
	cd $(BLOCKCHAIN) && forge coverage

# ─── Database ────────────────────────────────────────────────────────
db-reset: ## Créer/reset la BDD SQLite
	@$(ROOT)/scripts/init-db.sh $(BACKEND)/heritage.db

db-seed: db-reset ## Reset BDD + insérer données de démo
	@echo "🌱 Seed de la BDD..."
	@sqlite3 $(BACKEND)/heritage.db < $(ROOT)/scripts/seed.sql
	@echo "✅ Données de démo insérées"

# ─── Deploy Blockchain ───────────────────────────────────────────────
deploy-fuji: ## Déployer HeritageFactory sur Fuji testnet
	@test -n "$$PRIVATE_KEY" || (echo "❌ PRIVATE_KEY non définie" && exit 1)
	cd $(BLOCKCHAIN) && forge script script/Deploy.s.sol:DeployScript \
		--rpc-url $(RPC_FUJI) \
		--chain-id $(CHAIN_FUJI) \
		--broadcast \
		-vvvv

deploy-mainnet: ## Déployer HeritageFactory sur Avalanche mainnet
	@test -n "$$PRIVATE_KEY" || (echo "❌ PRIVATE_KEY non définie" && exit 1)
	@echo "⚠️  MAINNET — Es-tu sûr ? (Ctrl+C pour annuler)"
	@sleep 3
	cd $(BLOCKCHAIN) && forge script script/Deploy.s.sol:DeployScript \
		--rpc-url $(RPC_MAIN) \
		--chain-id $(CHAIN_MAIN) \
		--broadcast \
		--verify \
		-vvvv

verify-fuji: ## Vérifier les contrats sur Snowtrace (Fuji)
	@test -n "$$FACTORY_ADDRESS" || (echo "❌ FACTORY_ADDRESS non définie" && exit 1)
	@test -n "$$SNOWTRACE_API_KEY" || (echo "❌ SNOWTRACE_API_KEY non définie" && exit 1)
	cd $(BLOCKCHAIN) && forge verify-contract $$FACTORY_ADDRESS src/HeritageFactory.sol:HeritageFactory \
		--chain $(CHAIN_FUJI) \
		--etherscan-api-key $$SNOWTRACE_API_KEY

# ─── Formatting / Lint ───────────────────────────────────────────────
fmt: ## Formatter le code (Rust + Solidity)
	cd $(BACKEND) && cargo fmt
	cd $(BLOCKCHAIN) && forge fmt

lint: ## Linter
	cd $(BACKEND) && cargo clippy -- -W warnings
	cd $(FRONTEND) && pnpm exec tsc --noEmit

check: fmt lint test ## Format + lint + test

# ─── OVH Kubernetes ─────────────────────────────────────────────────
ovh-init: ## [OVH] Setup initial (namespace, secrets, PVC, registry)
	$(ROOT)/scripts/ovh-deploy.sh --init

ovh-build: ## [OVH] Build & push Docker images vers le registry OVH
	$(ROOT)/scripts/ovh-deploy.sh --build

ovh-deploy: ## [OVH] Deployer l'app sur le cluster OVH
	$(ROOT)/scripts/ovh-deploy.sh

ovh-full: ## [OVH] Build + deploy complet
	$(ROOT)/scripts/ovh-deploy.sh --build

ovh-status: ## [OVH] Voir l'etat du deploiement
	@echo ""
	@echo "  Pods:"
	@$(OVH_KC) get pods -n $(OVH_NS) -o wide
	@echo ""
	@echo "  Services:"
	@$(OVH_KC) get svc -n $(OVH_NS)
	@echo ""
	@echo "  PVC:"
	@$(OVH_KC) get pvc -n $(OVH_NS)
	@echo ""
	@IP=$$($(OVH_KC) get svc frontend -n $(OVH_NS) -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null); \
	if [ -n "$$IP" ]; then \
		echo "  IP publique: $$IP"; \
		echo "  Site: http://$$IP"; \
	else \
		echo "  IP publique: en attente..."; \
	fi
	@echo ""

ovh-logs: ## [OVH] Voir les logs (backend par defaut)
	$(OVH_KC) logs -n $(OVH_NS) -l app.kubernetes.io/name=backend -f --tail=100

ovh-logs-front: ## [OVH] Voir les logs frontend
	$(OVH_KC) logs -n $(OVH_NS) -l app.kubernetes.io/name=frontend -f --tail=100

ovh-db-reset: ## [OVH] Reset la BDD (DESTRUCTIF!)
	$(ROOT)/scripts/ovh-deploy.sh --db-reset

ovh-shell: ## [OVH] Ouvrir un shell dans le pod backend
	$(OVH_KC) exec -it -n $(OVH_NS) deployment/backend -- /bin/bash

ovh-ip: ## [OVH] Afficher l'IP publique du LoadBalancer
	@$(OVH_KC) get svc frontend -n $(OVH_NS) -o jsonpath='{.status.loadBalancer.ingress[0].ip}' && echo ""

# ─── Docker ──────────────────────────────────────────────────────────
docker-build: ## Build les images Docker
	docker build -t heritage-backend $(BACKEND)
	docker build -t heritage-frontend $(FRONTEND)

# ─── Clean ───────────────────────────────────────────────────────────
clean: ## Nettoyer les artefacts de build
	cd $(BACKEND) && cargo clean
	cd $(BLOCKCHAIN) && forge clean
	rm -rf $(FRONTEND)/dist

clean-all: clean ## Nettoyer tout (+ node_modules, db)
	rm -rf $(FRONTEND)/node_modules
	rm -f $(BACKEND)/heritage.db $(BACKEND)/heritage.db-*

# ─── Deps internes ───────────────────────────────────────────────────
_deps-backend:
	@echo "  → Backend (Rust)..."
	@cd $(BACKEND) && cargo build 2>&1 | tail -1

_deps-frontend:
	@echo "  → Frontend (pnpm)..."
	@cd $(FRONTEND) && pnpm install --frozen-lockfile 2>/dev/null || pnpm install 2>&1 | tail -1

_deps-contracts:
	@echo "  → Smart contracts (Foundry)..."
	@cd $(BLOCKCHAIN) && forge build 2>&1 | tail -1
