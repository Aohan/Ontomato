import type { ArtifactType } from "@ontomato/contracts/observe";
const ARTIFACT_TYPES = ["turn-workspace", "autotest-run"] as const;

export interface KeptArtifact {
  artifactType: ArtifactType;
  artifactId: string;
}

export function isArtifactType(value: string): value is ArtifactType {
  return ARTIFACT_TYPES.includes(value as ArtifactType);
}

export function hasArtifactRetention(
  kept: readonly KeptArtifact[],
  artifactType: ArtifactType,
  artifactId: string
): boolean {
  return kept.some((item) => item.artifactType === artifactType && item.artifactId === artifactId);
}
