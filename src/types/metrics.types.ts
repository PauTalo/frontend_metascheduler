export interface JobMetric {
  id: number;
  job_id: number;
  collected_at: string;
  cpu_usage: number;
  ram_usage: number;
  disk_read_bytes: number;
  disk_write_bytes: number;
}

export interface JobNodeMetric {
  id: number;
  job_id: number;
  node_ip: string;
  collected_at: string;
  cpu_usage: number;
  ram_usage: number;
  disk_read_bytes: number;
  disk_write_bytes: number;
}

export interface ClusterNodeMetric {
  id: number;
  ip: string;
  port: number;
  cpu_percent: number;
  ram_percent: number;
  disk_percent: number;
  load1: number;
  is_alive: boolean | null;
  error: string | null;
}
