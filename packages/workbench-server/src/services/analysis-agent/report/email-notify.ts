import { workbenchProduct } from "../../../product/installed";
import { createTransport, type Transporter } from "nodemailer";
import { environment } from "../../../config/environment";
import { createLogger } from "../../../logging/logger";
import { marked } from "../delivery/marked";
import { renderChartsToDataUrls, replaceChartMarkersWithImages } from "../delivery/chart-renderer";
import { tApp } from "../../../i18n";


const logger = createLogger("email-notify");

function createTransporter(): Transporter | null {
  const { host, port, secure, user, pass } = environment.smtp();
  if (!host) return null;

  return createTransport({
    host,
    port,
    secure,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
}

async function sendEmail(params: { to: string; subject: string; html: string }): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) {
    logger.warn(tApp("analysis.report.email-notify.388"));
    return false;
  }

  const from = environment.smtp().from;

  try {
    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    logger.info(tApp("analysis.report.email-notify.389"), { to: params.to, subject: params.subject });
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(tApp("analysis.report.email-notify.390"), { error: errorMessage });
    return false;
  }
}

async function toHtml(md: string, chartHtmls: Record<string, string>): Promise<string> {
  let processed = md;

  const chartDataUrls = await renderChartsToDataUrls(chartHtmls);
  processed = await replaceChartMarkersWithImages(processed, chartDataUrls);

  return (marked.parse(processed) as string).replace(
    /<table>/g,
    '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">'
  );
}

async function buildTaskCompleteEmail(params: {
  taskName: string;
  agentName: string;
  question: string;
  report?: string;
  chartHtmls?: Record<string, string>;
  success: boolean;
  errorMessage?: string;
}): Promise<string> {
  const { taskName, agentName, question, report, chartHtmls, success, errorMessage } = params;
  const statusBadge = success
    ? tApp("analysis.report.email-notify.391")
    : tApp("analysis.report.email-notify.392");

  let reportHtml = "";
  if (success && report) {
    reportHtml = await toHtml(report, chartHtmls || {});
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;line-height:1.6">
<div style="max-width:800px;margin:0 auto;padding:24px">

<h2 style="margin:0 0 16px">${statusBadge} ${tApp("analysis.report.email-notify.heading", { taskName })}</h2>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tr>
    <td style="padding:8px 12px;background:#f8f9fa;font-weight:600;width:100px">${tApp("analysis.report.email-notify.agentLabel")}</td>
    <td style="padding:8px 12px">${agentName}</td>
  </tr>
  <tr>
    <td style="padding:8px 12px;background:#f8f9fa;font-weight:600">${tApp("analysis.report.email-notify.questionLabel")}</td>
    <td style="padding:8px 12px">${question}</td>
  </tr>
</table>

${
  reportHtml
    ? `
<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:16px">
  ${reportHtml}
</div>
`
    : ""
}

${
  !success && errorMessage
    ? tApp("analysis.report.email-notify.393", { errorMessage: errorMessage })
    : ""
}

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<div style="font-size:12px;color:#9ca3af">${workbenchProduct().emailFooter}</div>

</div>
</body>
</html>`.trim();
}

export class EmailNotifyService {
  async sendTaskCompleteNotification(params: {
    to: string;
    taskName: string;
    agentName: string;
    question: string;
    report?: string;
    chartHtmls?: Record<string, string>;
  }): Promise<boolean> {
    const { to, taskName, agentName, question, report, chartHtmls } = params;

    logger.info(tApp("analysis.report.email-notify.394"), { to, taskName, agentName });

    const html = await buildTaskCompleteEmail({
      taskName,
      agentName,
      question,
      report,
      chartHtmls,
      success: true,
    });

    return sendEmail({
      to,
      subject: tApp("analysis.report.email-notify.395", { taskName: taskName }),
      html,
    });
  }

  async sendTaskFailedNotification(params: {
    to: string;
    taskName: string;
    agentName: string;
    question: string;
    errorMessage: string;
  }): Promise<boolean> {
    const { to, taskName, agentName, question, errorMessage } = params;

    logger.info(tApp("analysis.report.email-notify.396"), { to, taskName, agentName });

    const html = await buildTaskCompleteEmail({
      taskName,
      agentName,
      question,
      success: false,
      errorMessage,
    });

    return sendEmail({
      to,
      subject: tApp("analysis.report.email-notify.397", { taskName: taskName }),
      html,
    });
  }
}

let emailNotifyInstance: EmailNotifyService | null = null;

export function getEmailNotifyService(): EmailNotifyService {
  if (!emailNotifyInstance) {
    emailNotifyInstance = new EmailNotifyService();
  }
  return emailNotifyInstance;
}
