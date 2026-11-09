# Makefile for `ofl`.
#
# Thin, discoverable wrappers over the bun scripts in package.json, plus a
# `release` target that compiles every binary and publishes a GitHub release.
# Recipes call bun through `mise exec` so they work even when make spawns a
# non-interactive shell that has not activated mise.

BUN := mise exec -- bun
NPM := mise exec -- npm
GH  := gh

# Release version, derived from package.json (e.g. v0.1.0). Override on the
# command line: `make release VERSION=v0.2.0`.
VERSION ?= v$(shell sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)

# Compiled binaries produced by scripts/compile.ts (all release targets).
TARGETS := linux-x64 linux-arm64 darwin-arm64 darwin-x64
BINARIES := $(addprefix release/ofl-,$(TARGETS))

.DEFAULT_GOAL := help
.PHONY: help install check compile compile-all load clean bump release

help: ## List available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) \
		| sed 's/:.*## /\t/' \
		| sort \
		| awk -F '\t' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	$(BUN) install

check: ## Run lint, format check, typecheck, and tests
	$(BUN) run check

compile: ## Compile the host binary into release/
	$(BUN) run compile

compile-all: ## Compile binaries for every release target
	$(BUN) run compile:all

load: ## Compile and install the host binary to ~/.local/bin/ofl
	$(BUN) run load

clean: ## Remove build output
	rm -rf release

bump: ## Bump version in package.json (PART=patch|minor|major)
	$(NPM) version $(PART) --no-git-tag-version
	@echo "package.json is now v$$(sed -n 's/.*\"version\": *\"\([^\"]*\)\".*/\1/p' package.json | head -1) — commit it, then: make release"

PART ?= patch

release: check compile-all ## Cut a GitHub release (VERSION=v0.1.0) with all binaries
	@command -v $(GH) >/dev/null || { echo "gh CLI not found"; exit 1; }
	@$(GH) auth status >/dev/null 2>&1 || { echo "run: gh auth login"; exit 1; }
	@if $(GH) release view $(VERSION) >/dev/null 2>&1; then \
		echo "release $(VERSION) already exists"; exit 1; \
	fi
	@echo "Publishing release $(VERSION) at $$(git rev-parse --short HEAD)"
	$(GH) release create $(VERSION) $(BINARIES) \
		--title "$(VERSION)" \
		--generate-notes
