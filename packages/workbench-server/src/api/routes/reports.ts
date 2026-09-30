import { Request, Response, Router } from "express";
import { exportMarkdownPdf } from "../../services/analysis-agent/delivery/pdf-export";
import { asyncHandler } from "../utils/http";
import { t, tApp } from "../../i18n";
const router: ReturnType<typeof Router> = Router();

router.post(
  "/export-pdf",
  asyncHandler(async (req: Request, res: Response) => {
    const title = String(req.body?.title || t("report.defaultTitle")).trim() || tApp("foundation.report.defaultTitle");
    const markdown = String(req.body?.markdown || "");
    const renderInlineCharts = req.body?.renderInlineCharts === true;
    const pdf = await exportMarkdownPdf({ title, markdown, renderInlineCharts });

    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  })
);

export default router;
