import { z } from "zod";

/**
 * `data` of GET /businessConfig/getConfigAndDesc: the data engine's diagnosis view of its running configuration and
 * the notes on how changes take effect. Only these named non-secret fields cross into the workbench server; z.object
 * drops every other key, so an unexpected key/header/parameter in a response never reaches a diagnosis output.
 * Shapes follow the data engine's JSON as served (nulls written, durations as ISO-8601 text); the shared samples
 * under __tests__/fixtures are checked against both sides.
 */
const role = z.object({ model: z.string().nullable() });

export const diagnosticConfigSchema = z.object({
  server: z.object({
    port: z.number(),
    "max-http-post-size": z.string().nullable(),
  }),
  spring: z.object({
    servlet: z.object({
      multipart: z.object({
        "max-file-size": z.string().nullable(),
        "max-request-size": z.string().nullable(),
      }),
    }),
  }),
  langchain4j: z.object({
    "open-ai": z.object({
      models: z.array(
        z.object({
          name: z.string(),
          displayName: z.string(),
          modelName: z.string(),
          connectionConfigured: z.boolean(),
          timeout: z.string().nullable(),
          maxRetries: z.number().nullable(),
          maxTokens: z.number(),
          contextWindow: z.number(),
        })
      ),
      agents: z.object({
        query: role,
        coding: role.extend({ skilldir: z.string().nullable() }),
        general: role,
        diagnosis: role,
        knowledgeGovernance: role,
      }),
      /** Absent when no Embedding model is configured. */
      "embedding-model": z
        .object({
          modelName: z.string().nullable(),
          apiKeyConfigured: z.boolean(),
          timeout: z.string().nullable(),
        })
        .optional(),
    }),
  }),
  ontomato: z.object({
    "data-engine": z.object({
      dataAdapter: z.string(),
      knowledgeMaxResult: z.number(),
      toolAndPythonRetry: z.number(),
      dslCookerTries: z.number().nullable(),
      dslCookerTimeout: z.number().nullable(),
      questionSpliterTries: z.number().nullable(),
      questionSpliterTimeout: z.number().nullable(),
    }),
  }),
  subQueryCacheDir: z.string(),
});

export type DiagnosticConfig = z.infer<typeof diagnosticConfigSchema>;

/** The whole response; a failure keeps no message, so nothing the data engine echoes reaches a diagnosis output. */
export const diagnosticConfigResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    data: z.object({ config: diagnosticConfigSchema, desc: z.string() }),
  }),
  z.object({ success: z.literal(false) }),
]);
