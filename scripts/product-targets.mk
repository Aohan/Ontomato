# 产品根聚合入口。两个产品仓各自 include 这一份，它只按顺序调用各仓既有的分服务
# 目标，不承载构建逻辑，也不识别任何一仓独有的变量（如企业 License 模式）。
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
