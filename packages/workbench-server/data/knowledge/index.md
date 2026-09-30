# Operations Knowledge

This directory stores the product operations model and failure modes that the operations Agent reads on demand. It helps establish product expectations and find evidence; it does not store the current value of any environment, nor can it replace the business-correctness baseline of the current round of evidence collection or user confirmation.

## Choose a Topic by Goal

| Current goal | Minimum read scope |
| --- | --- |
| A page, service, or query is completely unavailable; configuration, permission, or metadata prerequisites are suspected | `infrastructure-and-runtime-prerequisites/index.md`, then only the specific topics |
| The planning, query, analysis, visualization, or final reply of a standard query Turn is off | `standard-query-turn/index.md`; only read failure modes in that directory when the characteristics match |
| The plan, current evidence, dimension report, summary, or task replay of an analysis agent task is off | `analysis-agent-tasks/index.md` |

It is not required to start from this index every time, nor to read all three topics in full. When the goal has already been determined from a Skill or page context, read the corresponding topic directly.

## Usage Boundaries

- The product model describes stable components, links, invariants, evidence maps, and influence relationships; the design expectations and current implementation sources are marked separately in each article.
- Failure modes only provide candidate causes and verification entry points. Similar symptoms do not equal a match; conclusions must return to the current round of tool results, workspace artifacts, logs, or user evidence.
- Service status, effective configuration, permissions, metadata, and business data are all dynamic facts: prefer existing runtime tools and their existing auth or connections, external permission systems, and the current round of evidence; when a capability cannot obtain them, state the evidence gap clearly and ask the user to supplement.
- The user's expected answer, statistical definitions, and the meaning of business terms do not belong in this knowledge base; when missing, confirm with the user first.
