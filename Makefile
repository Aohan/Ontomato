NODE ?= node
HOST_ARCH := $(shell $(NODE) -p "process.arch === 'x64' ? 'amd64' : process.arch")
# By default only the host architecture is handled; named targets select amd64 or arm64.
ARCH ?= $(HOST_ARCH)
PROMPT_LANG ?= en

.PHONY: build pack pack-app pack-amd64 pack-arm64 pack-app-amd64 pack-app-arm64 workbench-runtime workbench-runtime-pack workbench-runtime-amd64 workbench-runtime-arm64 workbench-runtime-pack-amd64 workbench-runtime-pack-arm64 workbench-app workbench-app-pack workbench-app-amd64 workbench-app-arm64 workbench-app-pack-amd64 workbench-app-pack-arm64

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
