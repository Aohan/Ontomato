import { workbenchProduct } from "../../product/installed";
import { ensureGovernanceHarnessLinks } from "./20260923-governance-harness-links/schema";
import { ensureAnalysisHarnessLinks } from "./20260923-analysis-harness-links/schema";
import {
  PRESENTATION_CONTRACT_NAME,
  PRESENTATION_CONTRACT_VERSION,
  ensurePresentationContractSchema,
  migratePresentationContract,
} from "./20260908-presentation-contract/migration";
import { createLogger } from "../../logging/logger.js";
import { tApp } from "../../i18n/index.js";
import { qualifiedTable } from "../postgres.js";
import type { QueryableClient } from "./helpers.js";
import {
  BUSINESS_STORAGE_V1_NAME,
  BUSINESS_STORAGE_V1_VERSION,
  migrateBusinessStorageV1,
  syncThreadMetadataLastRequestSeq,
} from "./20260625-business-storage-v1/migration.js";
import { syncAnalysisTaskArtifacts } from "./20260625-business-storage-v1/analysis-task-snapshots.js";
import { ensureBusinessStorageV1Schema } from "./20260625-business-storage-v1/schema.js";
import { ensureCoreSchemaBaseline } from "./20260827-core-schema-baseline/schema.js";
import {
  ABC_REFERENCE_STORAGE_NAME,
  ABC_REFERENCE_STORAGE_VERSION,
  migrateAbcReferenceStorage,
} from "./20260724-abc-reference-storage/migration.js";
import {
  REPORT_AUTHORITY_SPLIT_NAME,
  REPORT_AUTHORITY_SPLIT_VERSION,
  migrateReportAuthorityScheduleSplit,
} from "./20260828-report-authority-schedule-split/migration.js";
import { ensureScheduleRuleSchema } from "./20260828-report-authority-schedule-split/schema.js";
import {
  QUERY_FACT_STORAGE_TEMPLATE_NAME,
  QUERY_FACT_STORAGE_TEMPLATE_VERSION,
  migrateQueryFactStorageTemplate,
} from "./20260831-query-fact-storage-template/migration.js";
import { ensureQueryFactStorageTemplate } from "./20260831-query-fact-storage-template/schema.js";
import {
  CHAT_SNAPSHOT_FACT_RETIREMENT_NAME,
  CHAT_SNAPSHOT_FACT_RETIREMENT_VERSION,
  migrateChatSnapshotFactRetirement,
} from "./20260901-chat-snapshot-fact-retirement/migration.js";
import { ensureReportDeliverableToggleSchema } from "./20260901-report-deliverable-toggle/schema.js";
import { ensureAnalysisAgentMcpServicesSchema } from "./20260901-analysis-agent-mcp-services/schema.js";
import { ensureKnowledgeGovernanceSchema } from "./20260910-knowledge-governance/schema.js";
import { ensureAnalysisReportSummaryPositionSchema } from "./20260918-analysis-report-summary-position/schema.js";
import { ensureAnalysisAgentHotReportSchema } from "./20260929-analysis-agent-hot-report/schema.js";
import {
  QUERY_RUN_BACKEND_SESSIONS_NAME,
  QUERY_RUN_BACKEND_SESSIONS_VERSION,
  migrateQueryRunBackendSessions,
} from "./20260922-query-run-backend-sessions/migration.js";
import { ensureQueryRunBackendSessionsSchema } from "./20260922-query-run-backend-sessions/schema.js";
import { ensureHarnessSessionsSchema } from "./20260922-harness-sessions/schema.js";

import {
  ANALYSIS_CONVERSATION_TURNS_VERSION,
  ANALYSIS_CONVERSATION_TURNS_NAME,
  migrateAnalysisConversationTurns,
} from "./20260911-analysis-conversation-turns/migration.js";
import {
  MCP_SERVICE_CONFIGS_VERSION,
  MCP_SERVICE_CONFIGS_NAME,
  migrateMcpServiceConfigs,
} from "./20260911-mcp-service-configs/migration.js";

const logger = createLogger("postgres:migrations");

export const BUSINESS_STORAGE_ARTIFACT_SYNC_VERSION = "20260811_business_storage_artifact_sync_v1";
const BUSINESS_STORAGE_ARTIFACT_SYNC_NAME = "business storage artifact synchronization v1";

type MigrationIdentity = { version: string; name: string };
type MigrationRegistration = {
  directory: string;
  ensureSchema: (client: QueryableClient) => Promise<void>;
  migration?: MigrationIdentity & {
    run: (client: QueryableClient, migration: MigrationIdentity) => Promise<void>;
  };
};

export const POSTGRES_MIGRATION_REGISTRY: MigrationRegistration[] = [
  { directory: "20260910-knowledge-governance", ensureSchema: ensureKnowledgeGovernanceSchema },
  { directory: "20260827-core-schema-baseline", ensureSchema: ensureCoreSchemaBaseline },
  {
    directory: "20260901-report-deliverable-toggle",
    ensureSchema: ensureReportDeliverableToggleSchema,
  },
  {
    directory: "20260901-analysis-agent-mcp-services",
    ensureSchema: ensureAnalysisAgentMcpServicesSchema,
  },
  {
    directory: "20260918-analysis-report-summary-position",
    ensureSchema: ensureAnalysisReportSummaryPositionSchema,
  },
  {
    directory: "20260929-analysis-agent-hot-report",
    ensureSchema: ensureAnalysisAgentHotReportSchema,
  },
  {
    directory: "20260625-business-storage-v1",
    ensureSchema: ensureBusinessStorageV1Schema,
    migration: {
      version: BUSINESS_STORAGE_V1_VERSION,
      name: BUSINESS_STORAGE_V1_NAME,
      run: runBusiness,
    },
  },
  {
    directory: "20260724-abc-reference-storage",
    ensureSchema: () => Promise.resolve(),
    migration: {
      version: ABC_REFERENCE_STORAGE_VERSION,
      name: ABC_REFERENCE_STORAGE_NAME,
      run: runAbc,
    },
  },
  {
    directory: "20260828-report-authority-schedule-split",
    ensureSchema: ensureScheduleRuleSchema,
    migration: {
      version: REPORT_AUTHORITY_SPLIT_VERSION,
      name: REPORT_AUTHORITY_SPLIT_NAME,
      run: runReportSplit,
    },
  },
  {
    directory: "20260831-query-fact-storage-template",
    ensureSchema: ensureQueryFactStorageTemplate,
    migration: {
      version: QUERY_FACT_STORAGE_TEMPLATE_VERSION,
      name: QUERY_FACT_STORAGE_TEMPLATE_NAME,
      run: runQueryFact,
    },
  },
  {
    directory: "20260901-chat-snapshot-fact-retirement",
    ensureSchema: () => Promise.resolve(),
    migration: {
      version: CHAT_SNAPSHOT_FACT_RETIREMENT_VERSION,
      name: CHAT_SNAPSHOT_FACT_RETIREMENT_NAME,
      run: runChatRetirement,
    },
  },
  {
    directory: "20260908-presentation-contract",
    ensureSchema: ensurePresentationContractSchema,
    migration: {
      version: PRESENTATION_CONTRACT_VERSION,
      name: PRESENTATION_CONTRACT_NAME,
      run: runPresentation,
    },
  },
  {
    directory: "20260911-analysis-conversation-turns",
    ensureSchema: () => Promise.resolve(),
    migration: {
      version: ANALYSIS_CONVERSATION_TURNS_VERSION,
      name: ANALYSIS_CONVERSATION_TURNS_NAME,
      run: runAnalysisConversationTurns,
    },
  },
  {
    directory: "20260911-mcp-service-configs",
    ensureSchema: () => Promise.resolve(),
    migration: {
      version: MCP_SERVICE_CONFIGS_VERSION,
      name: MCP_SERVICE_CONFIGS_NAME,
      run: runMcpServiceConfigs,
    },
  },
  {
    directory: "20260922-query-run-backend-sessions",
    ensureSchema: ensureQueryRunBackendSessionsSchema,
    migration: {
      version: QUERY_RUN_BACKEND_SESSIONS_VERSION,
      name: QUERY_RUN_BACKEND_SESSIONS_NAME,
      run: runQueryRunBackendSessions,
    },
  },
  { directory: "20260922-harness-sessions", ensureSchema: ensureHarnessSessionsSchema },
  {
    directory: "20260923-analysis-harness-links",
    ensureSchema: () => Promise.resolve(),
    migration: {
      version: "20260923_analysis_harness_links_v1",
      name: "analysis Harness references",
      run: async (client, migration) => {
        if (await isMigrationApplied(client, migration.version)) return;
        await inMigrationTransaction(client, async () => {
          await ensureAnalysisHarnessLinks(client);
          await recordMigration(client, migration.version, migration.name);
        });
      },
    },
  },
  { directory: "20260923-governance-harness-links", ensureSchema: ensureGovernanceHarnessLinks },
];

export async function runPostgresBusinessMigrations(client: QueryableClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock(hashtext($1::text))", [workbenchProduct().migrationLockKey]);
  try {
    await ensureMigrationTable(client);
    // The core table baseline lands first: business-storage-v1's column backfill depends on thread_metadata already existing.
    for (const registration of POSTGRES_MIGRATION_REGISTRY) {
      await registration.ensureSchema(client);
    }
    for (const { migration } of POSTGRES_MIGRATION_REGISTRY) {
      if (migration) await migration.run(client, migration);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1::text))", [workbenchProduct().migrationLockKey]);
  }
}

async function runBusiness(client: QueryableClient, migration: MigrationIdentity): Promise<void> {
  const businessStorageApplied = await isMigrationApplied(client, migration.version);
  if (businessStorageApplied) {
    logger.debug(tApp("foundation.log.migrate.businessSkip"), { version: migration.version });
  } else {
    const copied = await inMigrationTransaction(client, async () => {
      const result = await migrateBusinessStorageV1(client);
      await recordMigration(client, migration.version, migration.name);
      await recordMigration(
        client,
        BUSINESS_STORAGE_ARTIFACT_SYNC_VERSION,
        BUSINESS_STORAGE_ARTIFACT_SYNC_NAME
      );
      return result;
    });
    logger.info(tApp("foundation.log.migrate.businessDone"), { version: migration.version, ...copied });
  }

  if (!(await isMigrationApplied(client, BUSINESS_STORAGE_ARTIFACT_SYNC_VERSION))) {
    const synced = await inMigrationTransaction(client, async () => {
      const syncedThreadSequences = await syncThreadMetadataLastRequestSeq(client);
      const analysisTaskArtifacts = await syncAnalysisTaskArtifacts(client);
      await recordMigration(
        client,
        BUSINESS_STORAGE_ARTIFACT_SYNC_VERSION,
        BUSINESS_STORAGE_ARTIFACT_SYNC_NAME
      );
      return { syncedThreadSequences, analysisTaskArtifacts };
    });
    logger.info(tApp("foundation.log.migrate.artifactSyncDone"), {
      version: BUSINESS_STORAGE_ARTIFACT_SYNC_VERSION,
      ...synced,
    });
  } else {
    logger.debug(tApp("foundation.log.migrate.artifactSyncSkip"), {
      version: BUSINESS_STORAGE_ARTIFACT_SYNC_VERSION,
    });
  }
}

async function runAbc(client: QueryableClient, migration: MigrationIdentity): Promise<void> {
  if (await isMigrationApplied(client, migration.version)) return;
  const migrated = await inMigrationTransaction(client, async () => {
    const result = await migrateAbcReferenceStorage(client);
    await recordMigration(client, migration.version, migration.name);
    return result;
  });
  if (migrated.terminalSkips.length > 0) {
    logger.warn(tApp("foundation.log.migrate.abcTerminalSkip"), migrated);
  } else {
    logger.info(tApp("foundation.log.migrate.abcDone"), migrated);
  }
}

async function runReportSplit(
  client: QueryableClient,
  migration: MigrationIdentity
): Promise<void> {
  if (await isMigrationApplied(client, migration.version)) return;
  const split = await inMigrationTransaction(client, async () => {
    const result = await migrateReportAuthorityScheduleSplit(client);
    await recordMigration(client, migration.version, migration.name);
    return result;
  });
  logger.info(tApp("foundation.log.migrate.reportSplitDone"), {
    version: migration.version,
    ...split,
  });
}

async function runQueryFact(client: QueryableClient, migration: MigrationIdentity): Promise<void> {
  if (await isMigrationApplied(client, migration.version)) return;
  const template = await inMigrationTransaction(client, async () => {
    const result = await migrateQueryFactStorageTemplate(client);
    await recordMigration(client, migration.version, migration.name);
    return result;
  });
  logger.info(tApp("foundation.log.migrate.queryFactDone"), {
    version: migration.version,
    ...template,
  });
}

async function runChatRetirement(
  client: QueryableClient,
  migration: MigrationIdentity
): Promise<void> {
  if (await isMigrationApplied(client, migration.version)) return;
  const retired = await inMigrationTransaction(client, async () => {
    const result = await migrateChatSnapshotFactRetirement(client);
    await recordMigration(client, migration.version, migration.name);
    return result;
  });
  if (retired.unrecoverableSnapshots.length > 0) {
    logger.warn(tApp("foundation.log.migrate.chatRetireDegraded"), {
      version: migration.version,
      ...retired,
    });
  } else {
    logger.info(tApp("foundation.log.migrate.chatRetireDone"), {
      version: migration.version,
      ...retired,
    });
  }
}

async function runPresentation(
  client: QueryableClient,
  migration: MigrationIdentity
): Promise<void> {
  if (await isMigrationApplied(client, migration.version)) return;
  const result = await inMigrationTransaction(client, async () => {
    const migrated = await migratePresentationContract(client);
    await recordMigration(client, migration.version, migration.name);
    return migrated;
  });
  if (result.terminalSkips.length) logger.warn(tApp("foundation.log.migrate.presentationDegraded"), result);
  else logger.info(tApp("foundation.log.migrate.presentationDone"), result);
}

async function runAnalysisConversationTurns(
  client: QueryableClient,
  migration: MigrationIdentity
): Promise<void> {
  if (await isMigrationApplied(client, migration.version)) return;
  await inMigrationTransaction(client, async () => {
    await migrateAnalysisConversationTurns(client);
    await recordMigration(client, migration.version, migration.name);
  });
}

async function runMcpServiceConfigs(
  client: QueryableClient,
  migration: MigrationIdentity
): Promise<void> {
  if (await isMigrationApplied(client, migration.version)) return;
  await inMigrationTransaction(client, async () => {
    await migrateMcpServiceConfigs(client);
    await recordMigration(client, migration.version, migration.name);
  });
}

async function runQueryRunBackendSessions(
  client: QueryableClient,
  migration: MigrationIdentity
): Promise<void> {
  if (await isMigrationApplied(client, migration.version)) return;
  const migrated = await inMigrationTransaction(client, async () => {
    const result = await migrateQueryRunBackendSessions(client);
    await recordMigration(client, migration.version, migration.name);
    return result;
  });
  logger.info(tApp("foundation.log.migrate.backendSessionsDone"), { version: migration.version, ...migrated });
}

async function ensureMigrationTable(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("schema_migrations")} (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function isMigrationApplied(client: QueryableClient, version: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM ${qualifiedTable("schema_migrations")} WHERE version = $1 LIMIT 1`,
    [version]
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

async function recordMigration(
  client: QueryableClient,
  version: string,
  name: string
): Promise<void> {
  await client.query(
    `INSERT INTO ${qualifiedTable("schema_migrations")} (version, name, applied_at)
     VALUES ($1, $2, NOW()) ON CONFLICT (version) DO NOTHING`,
    [version, name]
  );
}

async function inMigrationTransaction<T>(
  client: QueryableClient,
  run: () => Promise<T>
): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await run();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
