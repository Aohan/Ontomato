NODE ?= node
HOST_ARCH := $(shell $(NODE) -p "process.arch === 'x64' ? 'amd64' : process.arch")
# By default only the host architecture is handled; named targets select amd64 or arm64.
ARCH ?= $(HOST_ARCH)
PROMPT_LANG ?= en

include scripts/product-targets.mk

.PHONY: data-engine data-engine-app pack-data-engine pack-data-engine-app data-engine-amd64 data-engine-arm64 pack-data-engine-amd64 pack-data-engine-arm64 pack-data-engine-app-amd64 pack-data-engine-app-arm64 workbench-runtime workbench-runtime-pack workbench-runtime-amd64 workbench-runtime-arm64 workbench-runtime-pack-amd64 workbench-runtime-pack-arm64 workbench-app workbench-app-pack workbench-app-amd64 workbench-app-arm64 workbench-app-pack-amd64 workbench-app-pack-arm64 ontology-manager pack-ontology-manager ontology-manager-amd64 ontology-manager-arm64 pack-ontology-manager-amd64 pack-ontology-manager-arm64 bundle bundle-amd64 bundle-arm64

# This repository's image aliases, used only by its full-bundle entry point.
BUNDLE_IMAGES := \
  node-app-runtime:deploy-$(ARCH) \
  ontomato-app:deploy \
  datarag-opensource-runtime:deploy-$(ARCH) \
  datarag-opensource-app:deploy \
  ontomato-ontology-manager:deploy-$(ARCH) \
  pgvector/pgvector:pg18

# Full bundle: pack the images already built or imported for this architecture, the deploy
# templates and the assembly recipes into one offline bundle.
bundle:
	$(NODE) scripts/deploy-bundle.mjs --arch $(ARCH) --deploy-dir deploy --name ontomato \
	  $(foreach image,$(BUNDLE_IMAGES),--image $(image))

bundle-amd64 bundle-arm64:
	$(MAKE) bundle ARCH=$(@:bundle-%=%)

# data-engine (Java) targets.
data-engine:
	$(NODE) apps/data-engine/build.mjs all --arch $(ARCH) --prompt-lang $(PROMPT_LANG)

pack-data-engine:
	$(NODE) apps/data-engine/build.mjs all --arch $(ARCH) --prompt-lang $(PROMPT_LANG) --pack-runtime --pack-app

data-engine-app:
	$(NODE) apps/data-engine/build.mjs app --arch $(ARCH) --prompt-lang $(PROMPT_LANG)

pack-data-engine-app:
	$(NODE) apps/data-engine/build.mjs app --arch $(ARCH) --prompt-lang $(PROMPT_LANG) --pack-app

data-engine-amd64 data-engine-arm64:
	$(MAKE) data-engine ARCH=$(@:data-engine-%=%)

pack-data-engine-amd64 pack-data-engine-arm64:
	$(MAKE) pack-data-engine ARCH=$(@:pack-data-engine-%=%)

pack-data-engine-app-amd64 pack-data-engine-app-arm64:
	$(MAKE) pack-data-engine-app ARCH=$(@:pack-data-engine-app-%=%)

workbench-runtime:
	$(NODE) apps/workbench/build.mjs runtime --arch $(ARCH)

workbench-runtime-pack:
	$(NODE) apps/workbench/build.mjs runtime --arch $(ARCH) --pack-runtime

workbench-runtime-amd64 workbench-runtime-arm64:
	$(MAKE) workbench-runtime ARCH=$(@:workbench-runtime-%=%)

workbench-runtime-pack-amd64 workbench-runtime-pack-arm64:
	$(MAKE) workbench-runtime-pack ARCH=$(@:workbench-runtime-pack-%=%)

workbench-app:
	$(NODE) apps/workbench/build.mjs app --arch $(ARCH)

workbench-app-pack:
	$(NODE) apps/workbench/build.mjs app --arch $(ARCH) --pack-app

workbench-app-amd64 workbench-app-arm64:
	$(MAKE) workbench-app ARCH=$(@:workbench-app-%=%)

workbench-app-pack-amd64 workbench-app-pack-arm64:
	$(MAKE) workbench-app-pack ARCH=$(@:workbench-app-pack-%=%)

ontology-manager:
	$(NODE) apps/ontology-manager/build.mjs --arch $(ARCH)

pack-ontology-manager:
	$(NODE) apps/ontology-manager/build.mjs --arch $(ARCH) --pack

ontology-manager-amd64 ontology-manager-arm64:
	$(MAKE) ontology-manager ARCH=$(@:ontology-manager-%=%)

pack-ontology-manager-amd64 pack-ontology-manager-arm64:
	$(MAKE) pack-ontology-manager ARCH=$(@:pack-ontology-manager-%=%)
