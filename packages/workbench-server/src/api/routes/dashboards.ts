import { Router, type Router as ExpressRouter } from "express";

import { getOwnedDashboard, listDashboardGroups } from "../../services/dashboard/access";
import { analyzeChartWithLlm } from "../../services/dashboard/chart-analysis";
import { createDashboardFromAnalysis } from "../../services/dashboard/create-from-analysis";
import { getDashboardConditions, queryDashboardData } from "../../services/dashboard/dsl-execution";
import {
  addDashboardChart,
  changeDashboardChartType,
  createDashboardDimension,
  createEmptyDashboard,
  deleteDashboardById,
  deleteDashboardChart,
  deleteDashboardDimension,
  deleteDashboardMetric,
  renameDashboard,
  renameDashboardChart,
  renameDashboardDimension,
  renameDashboardMetric,
  replaceDashboardLayout,
  updateDashboardChartConditions,
} from "../../services/dashboard/mutations";
import { listDashboards } from "../../services/dashboard/store";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler } from "../utils/http";
const router: ExpressRouter = Router();
router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({
      data: await listDashboards(
        (req as AuthenticatedRequest).userId,
        requireDomainId(req as AuthenticatedRequest)
      ),
    });
  })
);
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const ownerId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);
    const detail = await getOwnedDashboard(ownerId, domainId, req.params.id);
    res.json({ data: detail });
  })
);
router.post(
  "/create",
  asyncHandler(async (req, res) => {
    const ownerId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);
    const data = await createEmptyDashboard(ownerId, domainId, req.body || {});
    res.json({ success: true, data });
  })
);
router.post(
  "/createDimension",
  asyncHandler(async (req, res) => {
    await createDashboardDimension(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/groups",
  asyncHandler(async (req, res) => {
    const data = await listDashboardGroups(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body?.id
    );
    res.json({ success: true, data });
  })
);
router.post(
  "/queryList",
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await listDashboards(
        (req as AuthenticatedRequest).userId,
        requireDomainId(req as AuthenticatedRequest)
      ),
    });
  })
);
router.post(
  "/query-by-id",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: { dimensions: [] } });
  })
);
router.post(
  "/create-from-analysis",
  asyncHandler(async (req, res) => {
    const { userId, token, locale } = req as AuthenticatedRequest;
    const data = await createDashboardFromAnalysis(
      userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {},
      token,
      locale
    );
    res.json({ success: true, data });
  })
);
router.post(
  "/add-chart",
  asyncHandler(async (req, res) => {
    await addDashboardChart(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/modify",
  asyncHandler(async (req, res) => {
    await renameDashboard(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/delete",
  asyncHandler(async (req, res) => {
    await deleteDashboardById(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/modifyDimensionName",
  asyncHandler(async (req, res) => {
    await renameDashboardDimension(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/deleteDimension",
  asyncHandler(async (req, res) => {
    await deleteDashboardDimension(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/modifyResultSetName",
  asyncHandler(async (req, res) => {
    await renameDashboardChart(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/deleteResultSet",
  asyncHandler(async (req, res) => {
    await deleteDashboardChart(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/modifyResultSetChartType",
  asyncHandler(async (req, res) => {
    await changeDashboardChartType(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/modifyResultSetConditions",
  asyncHandler(async (req, res) => {
    await updateDashboardChartConditions(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/modifyLayout",
  asyncHandler(async (req, res) => {
    await replaceDashboardLayout(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/modifyMetricName",
  asyncHandler(async (req, res) => {
    await renameDashboardMetric(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/deleteMetric",
  asyncHandler(async (req, res) => {
    await deleteDashboardMetric(
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest),
      req.body || {}
    );
    res.json({ success: true });
  })
);
router.post(
  "/ai/analyze",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await analyzeChartWithLlm(req.body || {}) });
  })
);
router.post(
  "/getConditionsFromDsls",
  asyncHandler(async (req, res) => {
    const { token, locale } = req as AuthenticatedRequest;
    const dsls = Array.isArray(req.body?.dsls) ? req.body.dsls : [];
    const data = await getDashboardConditions(dsls, token, locale);
    res.json({ success: true, data });
  })
);
router.post(
  "/getAnswerByDslConditionParam",
  asyncHandler(async (req, res) => {
    const { token, locale } = req as AuthenticatedRequest;
    const data = await queryDashboardData(req.body || {}, token, locale);
    res.json({ success: true, ...data });
  })
);
export default router;
