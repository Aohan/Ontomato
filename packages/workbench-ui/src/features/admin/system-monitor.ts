/**
 * 系统监控的公共类型与纯格式化函数（原 SystemMonitor.vue 内定义，移出不改）。
 * SystemStatus 只含两版共有字段；响应里的其它扩展字段由使用它的应用视图自行声明。
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
 * SystemMonitor 的 service-panels 插槽参数（资源总览与 backend 卡之间）：
 * status 为接口原完整响应；服务动作必须经 handleAction（先确认，再由公共页执行与刷新）。
 */
export interface SystemMonitorServicePanelsProps {
  status: SystemStatus | null;
  actionLoading: Record<string, boolean>;
  handleAction: (serviceName: string, action: string) => void;
  getActionLabel: (action: string) => string;
}

/** SystemMonitor 的具名插槽：service-panels 由需要扩展面板的应用组合页提供，开源入口直接使用本页时不提供。 */
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
