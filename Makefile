.PHONY: help install dev build test test-unit test-integration test-summary lint typecheck clean \
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

test: ## Run all tests (unit + integration)
	yarn test

test-unit: ## Run unit tests only
	yarn test:unit

test-integration: ## Run integration tests only
	yarn test:integration

test-summary: ## Run all tests (force, no cache) and print a global pass/fail summary
	@yarn turbo run test --force 2>&1 | tee /tmp/turbo-test-out.txt; \
	awk ' \
	  /Test Files/ { files += $$3 } \
	  /Tests / { \
	    for (i=1; i<=NF; i++) { \
	      if ($$i ~ /^[0-9]+$$/ && $$(i+1) == "passed") passed += $$i; \
	      if ($$i ~ /^[0-9]+$$/ && $$(i+1) == "failed") failed += $$i \
	    } \
	  } \
	  END { \
	    printf "\n── Test Summary ───────────────────\n"; \
	    printf "  Test Files : %d\n", files; \
	    printf "  Passed     : %d\n", passed; \
	    if (failed > 0) printf "  Failed     : %d\n", failed; \
	    printf "───────────────────────────────────\n" \
	  }' /tmp/turbo-test-out.txt

lint: ## Lint all packages
	yarn lint

typecheck: ## Type-check all packages
	yarn typecheck

# ── Maintenance ──────────────────────────────────────────────────────────────

clean: ## Remove all build artifacts and caches
	yarn clean
