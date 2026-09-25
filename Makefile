NODE ?= node
HOST_ARCH := $(shell $(NODE) -p "process.arch === 'x64' ? 'amd64' : process.arch")
# By default only the host architecture is handled; named targets select amd64 or arm64.
ARCH ?= $(HOST_ARCH)
PROMPT_LANG ?= en

.PHONY: build pack pack-app pack-amd64 pack-arm64 pack-app-amd64 pack-app-arm64

build:
	$(NODE) apps/data-engine/build.mjs all --arch $(ARCH) --prompt-lang $(PROMPT_LANG)

pack:
	$(NODE) apps/data-engine/build.mjs all --arch $(ARCH) --prompt-lang $(PROMPT_LANG) --pack-runtime --pack-app

pack-app:
	$(NODE) apps/data-engine/build.mjs app --arch $(ARCH) --prompt-lang $(PROMPT_LANG) --pack-app

pack-amd64 pack-arm64:
	$(MAKE) pack ARCH=$(@:pack-%=%)

pack-app-amd64 pack-app-arm64:
	$(MAKE) pack-app ARCH=$(@:pack-app-%=%)
