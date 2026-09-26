/**
 * Shared utilities for workspace artifact generation.
 */

import { WORKSPACE_DIRS } from "../workspaces/store";

/**
 * Format milliseconds into a human-readable duration string.
 *
 * Examples:
 * - 450 -> "450ms"
 * - 3200 -> "3.2s"
 * - 125000 -> "2m5.0s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m${remaining.toFixed(1)}s`;
}

/**
 * Subdirectory name constants for workspace artifacts.
 */
export const ARTIFACT_DIRS = WORKSPACE_DIRS;
