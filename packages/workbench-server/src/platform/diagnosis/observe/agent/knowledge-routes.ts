import type { HttpResponse } from "@ontomato/contracts/http";
import type {
  KnowledgeMarkdownFile,
  KnowledgeTreeResponse,
} from "@ontomato/contracts/diagnosis";
import { Request, Response, Router } from "express";
import { createLogger } from "../../../../logging/logger";
import {
  KNOWLEDGE_INDEX_RELATIVE_PATH,
  KnowledgeNotFoundError,
  KnowledgePathError,
  listKnowledgeTree,
  readKnowledgeMarkdown,
} from "./knowledge-store";

const router: ReturnType<typeof Router> = Router();
const logger = createLogger("observe:knowledge-routes");

router.get("/", (_req: Request, res: Response<HttpResponse<KnowledgeTreeResponse>>) => {
  try {
    res.json({
      success: true,
      data: {
        rootPath: "data/knowledge",
        indexPath: KNOWLEDGE_INDEX_RELATIVE_PATH,
        tree: listKnowledgeTree(),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to list knowledge tree", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

router.get("/content", (req: Request, res: Response<HttpResponse<KnowledgeMarkdownFile>>) => {
  try {
    const pathParam = typeof req.query.path === "string" ? req.query.path : "index.md";
    const file = readKnowledgeMarkdown(pathParam);
    res.json({ success: true, data: file });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (error instanceof KnowledgePathError) {
      res.status(400).json({ success: false, error: msg });
      return;
    }
    if (error instanceof KnowledgeNotFoundError) {
      res.status(404).json({ success: false, error: msg });
      return;
    }
    logger.error("Failed to read knowledge markdown", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
