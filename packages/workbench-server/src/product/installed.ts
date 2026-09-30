import type { WorkbenchProduct } from "./types";

let installed: WorkbenchProduct | null = null;

export function installWorkbenchProduct(product: WorkbenchProduct): void {
  installed = product;
}

export function workbenchProduct(): WorkbenchProduct {
  if (!installed) throw new Error("Workbench product identity is not installed");
  return installed;
}
