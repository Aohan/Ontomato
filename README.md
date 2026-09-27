# Ontomato

Ontomato 的公共产品源码仓，包含工作台、数据引擎与本体管理器。

本仓正在进行初始源码迁移。构建和运行说明随可验收的模块落地，不代表当前已能运行完整产品。

- `apps/`：应用启动与装配。
- `packages/`：公共共享实现与契约。
- `deploy/`、`docker/`、`scripts/`：产品部署与公共构建工具。

企业扩展在独立私有仓维护。公共仓应能够独立构建，不依赖企业源码、私有授权 SDK 或企业构建凭据。

## 产品构建入口

根目录的 `make` 默认执行 `make build`，按顺序构建 Node runtime、Node app、Java data-engine 与 Manager。`make pack` 导出 Node runtime、Node app、Java runtime、Java app 与 Manager 五类镜像包；`make pack-app` 只导出 Node app、Java app 与 Manager 三类应用包。

| 命令 | 生成范围 |
| --- | --- |
| `make build` | workbench-runtime → workbench-app → data-engine → ontology-manager |
| `make pack` | workbench-runtime-pack → workbench-app-pack → pack-data-engine → pack-ontology-manager |
| `make pack-app` | workbench-app-pack → pack-data-engine-app → pack-ontology-manager |
| `make pack-amd64` / `pack-arm64` | 以指定架构执行 `pack` |
| `make pack-app-amd64` / `pack-app-arm64` | 以指定架构执行 `pack-app` |

`pack-app` 只复用 Node 与 Java 已经导入的匹配 runtime，不重建 runtime；Manager 仍打独立镜像，没有 manager runtime。分服务目标（`workbench-runtime-pack`、`workbench-app-pack`、`pack-data-engine`、`pack-data-engine-app`、`pack-ontology-manager` 及其架构变体）仍可单独调用。

宿主需要 Node、Git、Docker 和 GNU Make；`ARCH` 默认本机架构，`PROMPT_LANG` 只控制 Java 提示词语言（默认 `en`）。`JDK_IMAGE`、`JRE_IMAGE`、`PYTHON_RUNTIME_IMAGE` 只在环境变量有值时传给构建，用来覆盖 Dockerfile 里的镜像源；脚本不保存第二套默认镜像。这 5 个应用制品不含 PostgreSQL 与部署离线 bundle：PostgreSQL 由部署流程另行提供，离线 bundle 尚未在本仓落地；当前也没有私有 Linux 实物、完整 CI 或 dev.sh 的验收结论。

## 本机开发（Node + 主网页 + Manager）

`pnpm install` 后，根目录一次启动三个进程：

- `pnpm dev`：concurrently 同时运行下面三个脚本，前台运行，并向子进程转发 SIGINT/SIGTERM；
- `pnpm dev:server`：Node 服务（在 `apps/workbench` 执行 `tsx watch src/index.ts`，默认端口 3000）；
- `pnpm dev:web`：主网页 Vite 开发服务（端口 5173，`/api` 与 `/config.js` 代理到 3000）；
- `pnpm dev:ontology-manager`：本体管理器 Vite 开发服务（端口 5174，`/api/data-query` 代理到 `DATARAG_ORIGIN`）。

本仓 `package.json` 的 `packageManager` 固定 `pnpm@9.15.9`，`pnpm dev` 中 concurrently 的子命令通过 PATH 上的 `pnpm` 执行，所以仅用 `corepack pnpm ...` 不能保证 PATH 缺少 `pnpm` 或被其它版本覆盖时仍可用。使用 Corepack 时先执行 `corepack enable pnpm`，在产品根确认 `pnpm --version` 为 `9.15.9`，再执行 `pnpm install --frozen-lockfile`，之后用 `pnpm dev`。

Node 服务读取产品根 `.env`（进程环境优先），运行数据写在产品根 `data/`。本体管理器的 `DATARAG_ORIGIN` 在公共版没有默认值，未配置时启动报错，需在 `.env` 或环境变量中给出 DataRAG 根地址。Java 数据引擎、PostgreSQL 和 Python MCP 需要另行准备；本入口只有上述三个进程，不是全栈启动。

## 本机开发（Java 数据引擎）

`node apps/data-engine/dev.mjs [额外 Maven 参数]`：在本仓 reactor 根前台执行 `./mvnw -B -ntp -DskipTests -pl apps/data-engine -am spring-boot:run`，运行的是当前工作区源码，不需要 `mvn install`。额外参数原样透传给 Maven（例如 `-o`）。

- 启动脚本自动按构建入口的资源与语言准备 `apps/data-engine/.dev`（`conf`、`skills`、`logs`、`python`，JVM 工作目录，`conf` 在 classpath 最前）。同步规则与容器相同：同名覆盖、新增补齐、多余保留，`application.yml` 与 `mcp-clients.yml` 只在缺失时复制。提示词语言默认 `en`，可用 `PROMPT_LANG=zh|en` 指定。
- 需要先自行准备 `apps/data-engine/.env`（Java 的 `POSTGRE_*`、`BACKEND_*` 等，按宿主口径填写；逐行 `KEY=value` 字面读取，覆盖继承的同名环境变量）和 `apps/data-engine/.venv`（`python3 -m venv apps/data-engine/.venv && apps/data-engine/.venv/bin/pip install -r packages/data-engine-core/requirements-py310.txt`）。缺少任一项时在启动 Maven 前报错。
- 本入口只启动 JVM：PostgreSQL 和 Python MCP（`mcp-clients.yml` 默认 `127.0.0.1:18500`）需另行就绪，不是全栈启动。Ctrl-C/SIGTERM 转发给 Maven wrapper。

## 统一整栈开发入口

`./dev.sh [up|down|status|logs]`（缺省 `up`）按 PG → 本机 Python MCP → Java 就绪 → 前台 Node 三进程的顺序启动整栈；MCP 与 Java 是独立后台进程组，日志分别追加到 `apps/data-engine/.dev/logs/dev-mcp.log` 与 `dev-backend.log`。

- `up`：先校验端口、`apps/data-engine/.env`、`.venv` 与 `dev/postgres.compose.yml`，再启动 Compose。前台只有 Node 三进程（显式 `PORT=3000`），Ctrl-C 只停本组；PG/MCP/Java 已就绪时复用本检出，端口被其它进程占用时报错退出，不停止他人。
- `down`：按本检出的实际命令与 cwd 识别并停止前端（含父进程退出后残留的 concurrently/tsx/Vite 子树）、Java 入口与残留 Maven/RAGMain、MCP，超时补杀前再次确认同一 PID 的启动身份；最后 `docker compose down` 不带 `-v`，卷保留。
- `status` 只报本检出归属与外部端口占用提示，`logs` 跟随 `dev-backend.log`。Docker 未运行时提示启动 Docker Desktop 或 dockerd 后退出，不自动打开 GUI。

检出身份：Compose 项目名与卷名由产品根 realpath 派生（`<basename>-dev-<hash8>`），服务和卷带 `dev.stack.root`、`dev.stack.product` 标签；不同 worktree 即使 basename 相同也使用不同项目与卷。迁移目录后旧卷可用 `docker volume ls --filter label=dev.stack.product=<名>` 追溯；已有卷不自动迁移、补库或删除，建库 SQL 只在空卷首次初始化时执行。

准备本机配置（都只 `cp` 示例）：根 `.env`、`apps/data-engine/.env`、`apps/data-engine/.venv`（命令见上一节），以及需要时按同步后的 `apps/data-engine/.dev/conf/mcp-clients.yml` 创建的本机 MCP 条目——必须是唯一的 `http://127.0.0.1:<port>/sse`，允许同时保留远程条目。

端口：Node 3000、主网页 5173、Manager 5174 固定；PG 用 `DB_PORT`（默认 5432）、Java 用 `apps/data-engine/.env` 的 `SERVER_PORT`（默认 18087）、MCP 用 `mcp-clients.yml` 的本机端口（模板 18500）。端口被其它进程占用时 `up` 报错退出，不停止他人进程。两个产品根各自只需在自己的根执行一次安装，企业组合根的一次 `pnpm install` 即包含相邻公共仓。
