import { useJobs } from '../hooks/useJobs';
import { useClusterMetrics } from '../hooks/useClusterMetrics';
import { MetricsCard } from '../components/monitoring/MetricsCard';
import { ClusterStatus } from '../components/monitoring/ClusterStatus';
import { normalizeUserName, useAuthStore } from '../store/authStore';
import { Activity, CheckCircle, Clock, AlertTriangle, Server } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export function Dashboard() {
  const { user } = useAuthStore();
  const currentUser = normalizeUserName(user) ?? '';
  const { jobs, error } = useJobs(currentUser);
  const { metrics: clusterMetrics, loading: metricsLoading, error: metricsError } = useClusterMetrics();
  
  const running = jobs.filter(j => j.status === 'RUNNING').length;
  const pending = jobs.filter(j => j.status === 'QUEUED' || j.status === 'TO_BE_QUEUED').length;
  const completed = jobs.filter(j => j.status === 'COMPLETED').length;
  const errors = jobs.filter(j => j.status === 'ERROR').length;
  const recent = [...jobs].sort((a, b) => b.id_ - a.id_).slice(0, 5);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricsCard title="En ejecución" value={running} color="green" icon={<Activity size={18} />} />
        <MetricsCard title="Pendientes" value={pending} color="yellow" icon={<Clock size={18} />} />
        <MetricsCard title="Completados" value={completed} color="blue" icon={<CheckCircle size={18} />} />
        <MetricsCard title="Errores" value={errors} color="red" icon={<AlertTriangle size={18} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Últimos trabajos
          </h3>
          {recent.length === 0 ? (
            <p className="text-sm text-gray-400">Sin trabajos</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b">
                  <th className="pb-1">ID</th>
                  <th className="pb-1">Nombre</th>
                  <th className="pb-1">Tipo</th>
                  <th className="pb-1">Estado</th>
                  <th className="pb-1">Creado</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(job => (
                  <tr key={job.id_} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-1.5 text-gray-500">{job.id_}</td>
                    <td className="py-1.5 font-medium text-gray-800">{job.name}</td>
                    <td className="py-1.5 text-gray-500">{job.scheduler_type === 'S' ? 'SGE' : 'Hadoop'}</td>
                    <td className="py-1.5">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="py-1.5 text-gray-400 text-xs">
                      {format(new Date(job.created_at), 'dd MMM HH:mm', { locale: es })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <ClusterStatus />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <Server size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Métricas de nodos del clúster
          </h3>
        </div>

        {metricsError && (
          <p className="text-sm text-red-500">{metricsError}</p>
        )}

        {metricsLoading && clusterMetrics.length === 0 ? (
          <p className="text-sm text-gray-400">Cargando métricas…</p>
        ) : clusterMetrics.length === 0 ? (
          <p className="text-sm text-gray-400">Sin datos de métricas disponibles</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b">
                <th className="pb-1">Nodo</th>
                <th className="pb-1">CPU</th>
                <th className="pb-1">RAM</th>
                <th className="pb-1">Disco</th>
                <th className="pb-1">Carga</th>
                <th className="pb-1">Estado</th>
              </tr>
            </thead>
            <tbody>
              {clusterMetrics.map(m => (
                <tr key={m.ip} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-1.5 font-medium text-gray-700">{m.ip}</td>
                  <td className="py-1.5 text-gray-600">{(m.cpu_percent ?? 0).toFixed(1)}%</td>
                  <td className="py-1.5 text-gray-600">{(m.ram_percent ?? 0).toFixed(1)}%</td>
                  <td className="py-1.5 text-gray-600">{(m.disk_percent ?? 0).toFixed(1)}%</td>
                  <td className="py-1.5 text-gray-600">{(m.load1 ?? 0).toFixed(2)}</td>
                  <td className="py-1.5 text-xs">
                    {m.error
                      ? <span className="text-red-500">{m.error}</span>
                      : <span className="text-green-600">OK</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    RUNNING: 'bg-green-100 text-green-700',
    QUEUED: 'bg-yellow-100 text-yellow-700',
    TO_BE_QUEUED: 'bg-yellow-100 text-yellow-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
    ERROR: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${classes[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}
