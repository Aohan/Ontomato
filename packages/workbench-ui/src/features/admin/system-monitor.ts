/**
 * Shared system monitor types and pure formatting functions (originally defined in SystemMonitor.vue, moved unchanged).
 * SystemStatus holds only the fields common to both editions; other extension fields in the response are declared by the app views that use them.
 */
export interface CpuInfo {
  system: number;
  user: number;
  idle: number;
  wait: number;
  userate: number;
}

export interface MemoryInfo {
  total_gb: number;
  used_gb: number;
  free_gb: number;
  usage_percent: number;
}

export interface DiskInfo {
  partition: string;
  size: number;
  used: number;
  availible: number;
  usage_percent: number;
}

export interface ServerInfo {
  cpu: CpuInfo;
  memory: MemoryInfo;
  disk: DiskInfo[];
}

export interface ServiceItem {
  name: string;
  status: string;
  pid: number;
  user: string;
  cpu_percent: number;
  memory_mb: number;
  uptime_seconds: number;
  actions: string[];
}

export interface DockerContainer {
  name: string;
  image: string;
  status: string;
  cpu_percent: number;
  memory_mb: number;
  uptime_seconds: number;
  ports: string[];
}

export interface FrontendInfo {
  docker: {
    actions: string[];
    containers: DockerContainer[];
  };
}

export interface SystemStatus {
  timestamp: string;
  hostname: string;
  server: ServerInfo;
  backend: { service: ServiceItem };
  frontend: FrontendInfo;
}

/**
 * Props of the SystemMonitor service-panels slot (between the resource overview and the backend card):
 * status is the complete original API response; service actions must go through handleAction (confirm first, then the shared page executes and refreshes).
 */
export interface SystemMonitorServicePanelsProps {
  status: SystemStatus | null;
  actionLoading: Record<string, boolean>;
  handleAction: (serviceName: string, action: string) => void;
  getActionLabel: (action: string) => string;
}

/** Named slots of SystemMonitor: service-panels is provided by app pages that need extra panels; the open-source entry uses this page directly without it. */
export interface SystemMonitorSlots {
  "service-panels"?: (props: SystemMonitorServicePanelsProps) => unknown;
}

export function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatMemoryGB(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}
