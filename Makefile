.PHONY: help install dev build test lint typecheck clean \
        desktop desktop-build desktop-package

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Setup ────────────────────────────────────────────────────────────────────

install: ## Install all dependencies
	yarn install

# ── Development ──────────────────────────────────────────────────────────────

dev: ## Start all packages in watch mode
	yarn dev

desktop: ## Start the Electron desktop app (dev)
	yarn desktop:dev

# ── Build ────────────────────────────────────────────────────────────────────

build: ## Build all packages
	yarn build

desktop-build: ## Build the desktop app renderer + main
	yarn desktop:build

desktop-package: ## Package the desktop app into a distributable
	yarn desktop:package

# ── Quality ──────────────────────────────────────────────────────────────────

test: ## Run all tests
	yarn test

lint: ## Lint all packages
	yarn lint

typecheck: ## Type-check all packages
	yarn typecheck

# ── Maintenance ──────────────────────────────────────────────────────────────

clean: ## Remove all build artifacts and caches
	yarn clean
