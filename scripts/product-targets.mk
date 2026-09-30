# Product-root aggregate entry point. Each of the two product repositories includes this
# file; it only calls each repository's existing per-service targets in order, carries no
# build logic, and recognizes no variable unique to one repository (such as the enterprise
# license mode).
.DEFAULT_GOAL := build

.PHONY: build build-app pack pack-app pack-amd64 pack-arm64 pack-app-amd64 pack-app-arm64

build:
	$(MAKE) workbench-runtime
	$(MAKE) workbench-app
	$(MAKE) data-engine
	$(MAKE) ontology-manager

build-app:
	$(MAKE) workbench-app
	$(MAKE) data-engine-app
	$(MAKE) ontology-manager

pack:
	$(MAKE) workbench-runtime-pack
	$(MAKE) workbench-app-pack
	$(MAKE) pack-data-engine
	$(MAKE) pack-ontology-manager

pack-app:
	$(MAKE) workbench-app-pack
	$(MAKE) pack-data-engine-app
	$(MAKE) pack-ontology-manager

pack-amd64 pack-arm64:
	$(MAKE) pack ARCH=$(@:pack-%=%)

pack-app-amd64 pack-app-arm64:
	$(MAKE) pack-app ARCH=$(@:pack-app-%=%)
