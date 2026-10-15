# Shared aggregate target; each edition owns its service builders.
.DEFAULT_GOAL := build
.PHONY: build
build:
	$(MAKE) workbench
	$(MAKE) data-engine
	$(MAKE) ontology-manager
