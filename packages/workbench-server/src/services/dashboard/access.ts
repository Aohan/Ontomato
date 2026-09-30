import type { DashboardDetail, DashboardGroup } from "@ontomato/contracts/dashboard";
import { t } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { requireOwner } from "../../utils/owner-guard";
import { getDashboard } from "./store";

export function requireDashboardId(value: unknown) {
  const id = String(value || "").trim();
  if (!id) throw new HttpError(400, "id is required");
  return id;
}
export function requireGroupId(value: unknown) {
  const id = String(value || "").trim();
  if (!id) throw new HttpError(400, "groupId is required");
  return id;
}
export function ensureDashboard(ownerId: string, detail: DashboardDetail | null): DashboardDetail {
  if (!detail || !requireOwner(detail.ownerId, ownerId)) {
    throw new HttpError(404, t("api.dashboardNotFound"));
  }
  return detail;
}
export function findGroup(detail: DashboardDetail, groupId: string): DashboardGroup {
  const group = detail.groups.find((item) => item.id === groupId);
  if (!group) throw new HttpError(404, t("api.dimensionNotFound"));
  return group;
}
export async function getOwnedDashboard(ownerId: string, domainId: string, id: unknown) {
  return ensureDashboard(ownerId, await getDashboard(ownerId, domainId, requireDashboardId(id)));
}
export async function listDashboardGroups(ownerId: string, domainId: string, id: unknown) {
  const detail = await getOwnedDashboard(ownerId, domainId, id);
  return detail.groups.map((group) => ({ id: group.id, title: group.title }));
}
