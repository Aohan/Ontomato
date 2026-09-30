export type Workspace =
  | "model"
  | "browser"
  | "assets"
  | "playground"
  | "visual-modeling"
  | "knowledge";
export type AssetTab = "metrics" | "actions" | "tasks" | "functions";
export type ModelResource = "objects" | "attributes" | "relations";

export interface OntologyResourceCounts {
  objects: number | null;
  attributes: number | null;
  relations: number | null;
  metrics: number | null;
  actions: number | null;
  functions: number | null;
  tasks: number | null;
}

export const emptyOntologyResourceCounts = (): OntologyResourceCounts => ({
  objects: null,
  attributes: null,
  relations: null,
  metrics: null,
  actions: null,
  functions: null,
  tasks: null,
});
