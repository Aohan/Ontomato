NODE ?= node
HOST_ARCH := $(shell $(NODE) -p "process.arch === 'x64' ? 'amd64' : process.arch")
ARCH ?= $(HOST_ARCH)
PROMPT_LANG ?= en

include scripts/product-targets.mk

.PHONY: workbench data-engine ontology-manager bundle deploy-kit

workbench:
	$(NODE) apps/workbench/build.mjs --arch $(ARCH)

data-engine:
	$(NODE) apps/data-engine/build.mjs --arch $(ARCH) --prompt-lang $(PROMPT_LANG)

ontology-manager:
	$(NODE) apps/ontology-manager/build.mjs --arch $(ARCH)

VERSION ?= $(shell $(NODE) --input-type=module -e 'import {readFileSync} from "node:fs"; import {readRevision} from "./scripts/build-support.mjs"; console.log(readRevision(readFileSync("pom.xml", "utf8")))')
IMAGE_TAG ?= $(VERSION)
IMAGE_REGISTRY ?= ghcr.io/aohan
MIRROR_STATE ?= $(CURDIR)/.build/mirror/$(ARCH)
BOOTSTRAP ?= 0

# Export already published final images. Keep MIRROR_STATE between releases.
bundle:
	$(NODE) scripts/deploy-bundle.mjs --arch $(ARCH) --deploy-dir deploy --name ontomato \
	  --version $(VERSION) --image-tag $(IMAGE_TAG) --registry $(IMAGE_REGISTRY) --state "$(MIRROR_STATE)" \
	  $(if $(filter 1,$(BOOTSTRAP)),--bootstrap,)
