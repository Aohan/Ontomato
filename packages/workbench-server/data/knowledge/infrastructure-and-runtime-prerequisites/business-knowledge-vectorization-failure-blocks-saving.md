# Business Knowledge Vectorization Failure Causes Save Failure

- **Scope**: business knowledge, query examples, and other content fail to save in the management page.
- **Mechanism source**: the query backend's various knowledge Daos (`dao/KnowledgeDao.java`, `dao/BussinessExampleDao.java`, etc.) synchronously call `service/ai/EmbeddingService` before saving, with no exception fallback in the call chain.
- **Last verified**: 2026-08-26.
- **Verification scope**: 2026-09-22 covers only the fact that business knowledge and business terms were merged into one entry (the standalone term entry, term retrieval, and `BussinessTermDao` were removed); the rest of this file was not re-verified.

## Symptoms

- Saving business knowledge or query examples fails, while the service as a whole is available.

## Possible Causes

This kind of content performs embedding synchronously before writing to the vector index, and the call chain has no try/catch: if the embedding request fails, the save fails, and the failure occurs before the write, so no half-record is left. The embedding model is built on-site from the current configuration; common failure causes: embedding configuration errors (especially baseurl not ending in `/v1`), model service unreachable, auth failure. The same pattern covers multiple save entry points such as knowledge, examples, templates, and metric cards — when one category fails, others usually fail too.

## Verification and Localization

1. Use `view_app_config` to check the embedding / vector model configuration, focusing on the baseurl suffix and auth instructions.
2. When the configuration is normal, ask the user to test the vector model directly on the system configuration page, or confirm the specific embedding call error from backend logs.
3. Record which page, what kind of content was being saved, what the API returned, and whether all categories fail.

## When to Exclude

- Only individual content fails to save while other content of the same kind is normal — more likely a content or index problem, not embedding configuration.
- Save succeeds but retrieval fails — belongs to vector retrieval or index problems, not this entry.
