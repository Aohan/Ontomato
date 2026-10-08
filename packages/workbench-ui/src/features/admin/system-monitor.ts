/** System monitor response types (host resources and the data engine process) and pure formatting functions. */
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
  available: number;
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
}

export interface SystemStatus {
  timestamp: string;
  hostname: string;
  server: ServerInfo;
  backend: { service: ServiceItem };
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
