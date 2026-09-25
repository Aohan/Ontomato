# Ontomato

Ontomato 的公共产品源码仓，包含工作台、数据引擎与本体管理器。

本仓正在进行初始源码迁移。构建和运行说明随可验收的模块落地，不代表当前已能运行完整产品。

- `apps/`：应用启动与装配。
- `packages/`：公共共享实现与契约。
- `deploy/`、`docker/`、`scripts/`：产品部署与公共构建工具。

企业扩展在独立私有仓维护。公共仓应能够独立构建，不依赖企业源码、私有授权 SDK 或企业构建凭据。

## 构建 data-engine

根目录的 `make build`、`make pack` 和 `make pack-app` 目前只构建数据引擎。它们不构建工作台或本体管理器，也不表示整个产品已经可以打包。

宿主需要 Node、Git、Docker 和 GNU Make。`ARCH` 默认是本机架构，`PROMPT_LANG` 默认 `en`。`JDK_IMAGE`、`JRE_IMAGE`、`PYTHON_RUNTIME_IMAGE` 只在环境变量有值时传给构建，用来覆盖 Dockerfile 里的镜像源；脚本不保存第二套默认镜像。

`make pack` 在一个进程里做一次 Maven 导出，同时生成 runtime 和 app，并在核验通过后把当前架构的指纹写入 `apps/data-engine/runtime-lock.json`。`make pack-app` 只使用已经导入的 runtime，不会构建 runtime。
