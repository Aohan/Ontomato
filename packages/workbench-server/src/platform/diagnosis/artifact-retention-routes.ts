import type { HttpResponse } from "@ontomato/contracts/http";
import type { ArtifactRetention, ArtifactType } from "@ontomato/contracts/observe";
import { Request, Response, Router } from "express";
import { createLogger } from "../../logging/logger";
import { loadRunMeta } from "./autotest/results/store";
import { loadManifest } from "./observe/workspaces/store";
import { setArtifactKept } from "./observe/artifact-retention/store";
import { isArtifactType } from "./observe/artifact-retention/types";
import type { AuthenticatedRequest } from "../../utils/request-identity";

const router: ReturnType<typeof Router> = Router();
const logger = createLogger("artifact-retention:routes");

router.put(
  "/:artifactType/:artifactId",
  async (req: Request, res: Response<HttpResponse<ArtifactRetention>>) => {
    const artifactType = req.params.artifactType;
    const artifactId = req.params.artifactId;
    const kept = (req.body as { kept?: unknown })?.kept;

    if (!isArtifactType(artifactType)) {
      res.status(400).json({ success: false, error: "Invalid artifact type" });
      return;
    }
    if (!isValidArtifactId(artifactId)) {
      res.status(400).json({ success: false, error: "Invalid artifact ID" });
      return;
    }
    if (typeof kept !== "boolean") {
      res.status(400).json({ success: false, error: "kept must be a boolean" });
      return;
    }

    try {
      if (!artifactExists(artifactType, artifactId, (req as AuthenticatedRequest).domainId)) {
        res.status(404).json({ success: false, error: "Artifact not found" });
        return;
      }

      await setArtifactKept(artifactType, artifactId, kept);
      logger.info("Artifact retention updated", { artifactType, artifactId, kept });
      res.json({ success: true, data: { kept } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to update artifact retention", { artifactType, artifactId, error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  }
);

function artifactExists(
  artifactType: ArtifactType,
  artifactId: string,
  domainId?: string
): boolean {
  const artifact =
    artifactType === "turn-workspace" ? loadManifest(artifactId) : loadRunMeta(artifactId);
  return !!domainId && artifact?.domainId === domainId;
}

function isValidArtifactId(artifactId: string): boolean {
  return (
    !!artifactId &&
    !/[/\\:*?"<>|]/.test(artifactId) &&
    !artifactId.includes("\u0000") &&
    !artifactId.includes("..")
  );
}

export default router;
