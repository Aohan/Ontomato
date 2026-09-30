import "./env";
import {
  installContentLayout,
  installRuntimeDefaults,
  installWorkbenchIdentity,
  installWorkbenchProduct,
} from "@ontomato/workbench-server";
import { ossContentLayout } from "./content";
import { productRoot } from "./root";
import { configureOssI18n } from "./i18n";
import { ossIdentity } from "./identity";
import { ossProduct } from "./product";
import { ossModelAgents } from "./model-agents";
import { ossWorkspaceArtifactText } from "./workspace-artifact-text";
import { ossRuntimeDefaults } from "./runtime-defaults";
import { installM3DiagnosticSupport } from "@ontomato/workbench-server/platform/diagnosis/observe/m3-support";
import { installModelAgentCatalog } from "@ontomato/workbench-server/logging/model-agents";
import { installWorkspaceArtifactText } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/artifact-text";
import { installCurrentDatasetRule, lastDatasetWithRows } from "@ontomato/workbench-server/services/chat/graph/utils/current-dataset";
import { installNoDataVisualization, noDataChart } from "@ontomato/workbench-server/services/chat/graph/nodes/visualization-no-data";

installContentLayout(ossContentLayout(productRoot));
installWorkbenchProduct(ossProduct);
installModelAgentCatalog(ossModelAgents);
installRuntimeDefaults(ossRuntimeDefaults);
installWorkbenchIdentity(ossIdentity);
installM3DiagnosticSupport(null);
installWorkspaceArtifactText(ossWorkspaceArtifactText);
installCurrentDatasetRule(lastDatasetWithRows);
installNoDataVisualization(noDataChart);
configureOssI18n();

const { createWorkbenchApp, startWorkbench } = await import(
  "@ontomato/workbench-server/http/create-app"
);
const { config } = await import("@ontomato/workbench-server/config/application");

const app = createWorkbenchApp();
await startWorkbench(app, config.port);
