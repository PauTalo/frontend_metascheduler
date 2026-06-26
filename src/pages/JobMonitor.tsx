import { useEffect, useState } from 'react';
import { useJobs } from '../hooks/useJobs';
import { getApiErrorMessage, jobsService, queuesService } from '../api/cgroups.api';
import { normalizeUserName, useAuthStore } from '../store/authStore';
import { Trash2, RefreshCw, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { JobEditModal } from '../components/jobs/JobEditModal';
import type { Job, JobStatus, Queue, SchedulerType } from '../types/job.types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const ALL_STATUSES: JobStatus[] = ['TO_BE_QUEUED', 'QUEUED', 'RUNNING', 'COMPLETED', 'ERROR'];

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const statusColors: Record<JobStatus, string> = {
  TO_BE_QUEUED: 'bg-gray-100 text-gray-600',
  QUEUED: 'bg-blue-100 text-blue-700',
  RUNNING: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-indigo-100 text-indigo-700',
  ERROR: 'bg-red-100 text-red-700',
};

export function JobMonitor() {
  const { user, role } = useAuthStore();
  const currentUser = normalizeUserName(user) ?? '';
  const canEdit = role !== 'guest';
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'ALL'>('ALL');
  const [queueFilter, setQueueFilter] = useState<number | 'ALL'>('ALL');
  const [typeFilter, setTypeFilter] = useState<SchedulerType | 'ALL'>('ALL');
  const [queues, setQueues] = useState<Queue[]>([]);
  const [queuesReady, setQueuesReady] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);

  const apiStatusFilter = statusFilter === 'ALL' ? undefined : statusFilter;
  const apiQueueFilter = queueFilter === 'ALL' ? undefined : queueFilter;
  const { jobs, loading, error, refresh } = useJobs(currentUser, {
    status: apiStatusFilter,
    queue: apiQueueFilter,
    enabled: queuesReady,
  });

  useEffect(() => {
    queuesService.getAll()
      .then(setQueues)
      .catch(() => {})
      .finally(() => setQueuesReady(true));
  }, []);

  const queueLabels = new Map(queues.map(queue => [queue.id, queue.scheduler_name]));

  const filtered = typeFilter === 'ALL'
    ? jobs
    : jobs.filter(j => j.scheduler_type === typeFilter);

  const handleDelete = async (jobId: number) => {
    try {
      const response = await jobsService.delete(jobId, currentUser);
      toast.success(response.message ?? `Trabajo ${jobId} eliminado`);
      await refresh();
    } catch (requestError) {
      toast.error(getApiErrorMessage(requestError, 'No se pudo eliminar el trabajo'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Monitor de trabajos</h1>
        {loading && <RefreshCw size={16} className="animate-spin text-gray-400" />}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as JobStatus | 'ALL')}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="ALL">Todos los estados</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={queueFilter}
          onChange={e => setQueueFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="ALL">Todas las colas</option>
          {queues.map(queue => (
            <option key={queue.id} value={queue.id}>
              {queue.scheduler_name} (ID {queue.id})
            </option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as SchedulerType | 'ALL')}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="ALL">Todos los tipos</option>
          <option value="S">SGE (HPC)</option>
          <option value="H">Hadoop (BigData)</option>
        </select>

        <span className="text-sm text-gray-400 self-center">{filtered.length} trabajos</span>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Scheduler</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Cola</th>
              <th className="px-4 py-3">Creado</th>
              <th className="px-4 py-3">Iniciado</th>
              <th className="px-4 py-3">Completado</th>
              <th className="px-4 py-3">Duración (s)</th>
              <th className="px-4 py-3">Directorio</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-gray-400">
                  No hay trabajos
                </td>
              </tr>
            ) : (
              filtered.map(job => (
                <tr key={job.id_} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2 text-gray-500">{job.id_}</td>
                  <td className="px-4 py-2 font-medium text-gray-800">{job.name}</td>
                  <td className="px-4 py-2 text-gray-500">{job.owner}</td>
                  <td className="px-4 py-2 text-gray-500">{job.scheduler_type === 'S' ? 'SGE' : 'Hadoop'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[job.status]}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{queueLabels.get(job.queue) ?? `ID ${job.queue}`}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs">
                    {format(new Date(job.created_at), 'dd MMM HH:mm', { locale: es })}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs">
                    {job.started_at ? format(new Date(job.started_at), 'dd MMM HH:mm', { locale: es }) : '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs">
                    {job.completed_at ? format(new Date(job.completed_at), 'dd MMM HH:mm', { locale: es }) : '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs">
                    {job.execution_time_seconds != null ? formatDuration(job.execution_time_seconds) : '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs font-mono">
                    {job.pwd || '—'}
                  </td>
                  <td className="px-4 py-2">
                    {canEdit && job.status === 'TO_BE_QUEUED' && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setEditingJob(job)}
                          className="text-gray-400 hover:text-indigo-500 transition-colors"
                          title="Editar"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(job.id_)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingJob && (
        <JobEditModal
          job={editingJob}
          queues={queues}
          onClose={() => setEditingJob(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
