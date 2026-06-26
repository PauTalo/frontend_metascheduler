export type SchedulerType = 'S' | 'H';

export type JobStatus = 'TO_BE_QUEUED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'ERROR';

export type ClusterMode = 'best_effort' | 'shared' | 'exclusive' | 'dynamic';

export interface Job {
  id_: number;
  name: string;
  queue: number;
  owner: string;
  status: JobStatus;
  path: string;
  scheduler_type: SchedulerType;
  options: string;
  scheduler_job_id: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  execution_time_seconds: number | null;
  pwd: string;
}

export interface NodeInfo {
  id: number;
  ip: string;
  port: number | string;
  is_alive: boolean | null;
}

export type Node = NodeInfo;

export interface Queue {
  id: number;
  scheduler_name: string;
}

export interface ClusterModeResponse {
  mode: ClusterMode;
}

export interface ApiStatus {
  status: string;
  root: boolean;
}

export interface ApiMessage {
  status?: string;
  message: string;
}
