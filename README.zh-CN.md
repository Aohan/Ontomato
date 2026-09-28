# Ontomato

[English](README.md) · [项目主页](https://ontomato.ai/)

给你的 AI 一份业务模型，再问它真实的业务问题。

Ontomato 用自然语言回答基于业务数据库的问题。每次查询都以 **ontomap** 为依据：它用业务语言描述你的表、字段和它们之间的关系。每个答案都能追溯到它来自的源记录。

## 给 AI Agent 的说明

这份 README 的写法是让编码 Agent（Claude Code、Codex、WorkBuddy，或任何能执行 shell 命令的 Agent）从头到尾把 Ontomato 搭起来。如果你就是这个 Agent：

1. 按[部署](#1-部署)操作。对话模型和向量模型的地址与密钥向用户要，不要自己编。
2. 服务全部 healthy 后，马上按[安装 Agent 技能](#2-安装-agent-技能)装好技能并加载。如果当前会话识别不到新装的技能，直接读每个技能的 `SKILL.md` 并照着做。
3. 用 `ontomato-ontomap-builder` 技能连接用户的数据库并构建 ontomap，见[连接数据并提问](#3-连接数据并提问)。

## 快速开始

### 1. 部署

需要：Docker Engine 26+ 及 Compose 插件、一个兼容 OpenAI 接口的对话模型、一个向量模型。镜像从 Docker Hub 拉取，支持 `linux/amd64` 和 `linux/arm64`。

```bash
git clone https://github.com/Aohan/Ontomato.git
cd Ontomato/deploy
cp .env.example .env
# 编辑 .env，然后：
docker compose up -d
```

`.env` 里要填下面这些，其他项都有可用的默认值，说明见 `.env.example` 的注释。

| 变量 | 取值 |
| --- | --- |
| `POSTGRES_PASSWORD` | 只用字母、数字、`.`、`_`、`-` |
| `BACKEND_LLM_BASE_URL`、`BACKEND_LLM_API_KEY`、`BACKEND_LLM_MODEL` | 对话模型 |
| `BACKEND_EMBEDDING_BASE_URL`、`BACKEND_EMBEDDING_API_KEY`、`BACKEND_EMBEDDING_MODEL`、`BACKEND_EMBEDDING_DIMENSIONS` | 向量模型；维度必须和模型输出一致 |
| `PUBLIC_HOST` | 浏览器访问这台服务器用的地址，填 IP 或域名 |

`docker compose ps` 显示所有服务都 healthy 后，以下端口可用：

| 端口 | 服务 |
| --- | --- |
| 3000 | Ontomato 网页与 API |
| 3005 | 本体管理器 |
| 18087 | 数据引擎 |
| 5432 | PostgreSQL |

### 2. 安装 Agent 技能

[agent-skills/zh](agent-skills/zh) 里有三个中文技能，英文版在 [agent-skills/en](agent-skills/en)。需要 Node.js 18+。

| 技能 | 用途 |
| --- | --- |
| `ontomato-ontomap-builder` | 把 Ontomato 连到数据库，编写并导入 ontomap，再用问题检验 |
| `ontomato-analyst` | 读取 ontomap，执行 DSL 查询和自然语言提问，调用分析智能体 |
| `ontomato-app-builder` | 在单独的测试部署上：导入生产环境的 ontomap、灌入测试数据，编写并调试指标视图（MetricView）、动作（Action）和调用它们的页面 |

把技能目录复制到 Agent 的技能目录。在仓库根目录执行：

```bash
# Claude Code
mkdir -p .claude/skills && cp -R agent-skills/zh/* .claude/skills/
# Codex
mkdir -p .agents/skills && cp -R agent-skills/zh/* .agents/skills/
```

| Agent | 项目级技能目录 | 用户级技能目录 |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Codex | `.agents/skills/` | `~/.agents/skills/` |
| WorkBuddy | — | `~/.workbuddy/skills/`，或 `workbuddy skills add <dir>` |

然后把每个技能目录里 `application.yml` 的 `envUrl` 改成网页地址，例如 `http://localhost:3000`。

需要深度分析报告时，再把 MCP 服务 `http://<host>:3000/mcp/analysis-agents`（Streamable HTTP）加到 Agent 里。

### 3. 连接数据并提问

告诉 Agent 用哪个数据库、想问什么，例如：

> 用 ontomato-ontomap-builder 技能，把 Ontomato 连到我的 PostgreSQL 数据库 db.example:5432/sales（用户 `report`，密码在环境变量 `$SALES_DB_PASSWORD` 里）。为订单、客户、商品三张表建 ontomap，导入后问几个问题检验一下。

Agent 会让 Ontomato 连上数据库、读取表结构、编写并导入 ontomap，再提几个测试问题。Ontomato 同一时间只连一个数据源；当前版本支持 PostgreSQL 作为业务数据库。

之后就可以在网页 `http://<host>:3000` 里提问，在本体管理器 `http://<host>:3005` 里查看或修改 ontomap。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `apps/` | 应用入口：网页（`workbench`）、数据引擎、本体管理器 |
| `packages/` | 共享实现与契约 |
| `agent-skills/` | Agent 技能，中英文各一套 |
| `deploy/` | Docker Compose 部署 |
| `docker/`、`scripts/` | 镜像配方与构建工具 |

本机开发和镜像构建见 [docs/development.md](docs/development.md)。

## 许可证

Ontomato 以 [Apache License 2.0](LICENSE) 授权，另见 [NOTICE](NOTICE)。

每个镜像都在 `/licenses/` 下附带 `LICENSE`、`NOTICE` 和自动生成的 `THIRD_PARTY_NOTICES.txt`，后者列出镜像里包含的第三方组件（应用文件部分在 `/app/licenses/`）。IBM Db2 的 JDBC 驱动因许可证限制再分发，不随镜像提供。
