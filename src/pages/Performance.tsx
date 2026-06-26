import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MetricsCard } from '../components/monitoring/MetricsCard';
import { useJobMetrics } from '../hooks/useJobMetrics';
import { useJobs } from '../hooks/useJobs';
import { normalizeUserName, useAuthStore } from '../store/authStore';

const METRIC_STATUSES = new Set(['RUNNING', 'COMPLETED', 'ERROR']);

const tooltipStyle = {
  backgroundColor: '#020617',
  border: '1px solid #334155',
  borderRadius: '0.75rem',
  color: '#e2e8f0',
};

export function Performance() {
  const { user } = useAuthStore();
  const owner = normalizeUserName(user) ?? '';
  const { jobs } = useJobs(owner);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  const eligibleJobs = useMemo(
    () => jobs.filter(j => METRIC_STATUSES.has(j.status)),
    [jobs],
  );

  // the metrics endpoint does validate owner against the job's real owner
  // (unlike the listing, which returns everything for owner=root). We use the
  // selected job's owner so guest (which queries as root) can still see metrics
  // for jobs owned by other users.
  const selectedJob = useMemo(
    () => jobs.find(j => j.id_ === selectedJobId),
    [jobs, selectedJobId],
  );
  const metricsOwner = selectedJob?.owner ?? owner;
  const { metrics, nodeMetrics, loading, error, refresh } = useJobMetrics(selectedJobId, metricsOwner);

  const avgCpu = useMemo(
    () => (metrics.length ? metrics.reduce((s, m) => s + m.cpu_usage, 0) / metrics.length : 0),
    [metrics],
  );
  const avgRam = useMemo(
    () => (metrics.length ? metrics.reduce((s, m) => s + m.ram_usage, 0) / metrics.length : 0),
    [metrics],
  );
  const totalDiskRead = useMemo(
    () => metrics.reduce((s, m) => s + m.disk_read_bytes, 0) / (1024 * 1024),
    [metrics],
  );
  const totalDiskWrite = useMemo(
    () => metrics.reduce((s, m) => s + m.disk_write_bytes, 0) / (1024 * 1024),
    [metrics],
  );

  const cpuRamSeries = useMemo(
    () =>
      metrics.map(m => ({
        time: format(new Date(m.collected_at), 'HH:mm:ss'),
        cpu: m.cpu_usage,
        ram: m.ram_usage,
      })),
    [metrics],
  );

  const diskSeries = useMemo(
    () =>
      metrics.map(m => ({
        time: format(new Date(m.collected_at), 'HH:mm:ss'),
        read: m.disk_read_bytes / (1024 * 1024),
        write: m.disk_write_bytes / (1024 * 1024),
      })),
    [metrics],
  );

  const nodeRows = useMemo(() => {
    if (!nodeMetrics.length) return [];
    const byIp: Record<string, { count: number; cpu: number; ram: number; read: number; write: number }> = {};
    for (const nm of nodeMetrics) {
      if (!byIp[nm.node_ip]) byIp[nm.node_ip] = { count: 0, cpu: 0, ram: 0, read: 0, write: 0 };
      byIp[nm.node_ip].count += 1;
      byIp[nm.node_ip].cpu += nm.cpu_usage;
      byIp[nm.node_ip].ram += nm.ram_usage;
      byIp[nm.node_ip].read += nm.disk_read_bytes;
      byIp[nm.node_ip].write += nm.disk_write_bytes;
    }
    return Object.entries(byIp).map(([ip, v]) => ({
      ip,
      cpu: v.cpu / v.count,
      ram: v.ram / v.count,
      read: v.read / v.count / (1024 * 1024),
      write: v.write / v.count / (1024 * 1024),
    }));
  }, [nodeMetrics]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-slate-100">Rendimiento</h1>
          <p className="text-sm text-slate-400">
            Métricas de CPU, RAM y disco por trabajo — polling cada 10 s.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400">Trabajo:</label>
        <select
          value={selectedJobId ?? ''}
          onChange={e => setSelectedJobId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          <option value="">— Selecciona un trabajo —</option>
          {eligibleJobs.map(j => (
            <option key={j.id_} value={j.id_}>
              #{j.id_} · {j.name} ({j.status})
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {selectedJobId === null ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-8 text-sm text-slate-400">
          Selecciona un trabajo para ver sus métricas de rendimiento.
        </div>
      ) : metrics.length === 0 && !loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-8 text-sm text-slate-400">
          No hay métricas disponibles para este trabajo.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricsCard title="CPU promedio" value={`${avgCpu.toFixed(1)} %`} color="blue" />
            <MetricsCard title="RAM promedio" value={`${avgRam.toFixed(0)} MB`} color="green" />
            <MetricsCard title="Disco leído" value={`${totalDiskRead.toFixed(1)} MB`} color="indigo" />
            <MetricsCard title="Disco escrito" value={`${totalDiskWrite.toFixed(1)} MB`} color="yellow" />
          </div>

          <Panel title="CPU y RAM a lo largo del tiempo" description="% CPU (izq.) y MB de RAM (der.)">
            <ResponsiveContainer width="100%" height={288}>
              <LineChart data={cpuRamSeries}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="cpu" stroke="#38bdf8" />
                <YAxis yAxisId="ram" orientation="right" stroke="#34d399" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Line yAxisId="cpu" type="monotone" dataKey="cpu" name="CPU %" stroke="#38bdf8" strokeWidth={2} dot={false} />
                <Line yAxisId="ram" type="monotone" dataKey="ram" name="RAM (MB)" stroke="#34d399" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Disco I/O a lo largo del tiempo" description="Lectura y escritura en MB">
            <ResponsiveContainer width="100%" height={288}>
              <LineChart data={diskSeries}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Line type="monotone" dataKey="read" name="Lectura (MB)" stroke="#a78bfa" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="write" name="Escritura (MB)" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          {nodeRows.length > 0 && (
            <Panel title="Métricas por nodo" description="Promedios por IP de nodo de ejecución">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-slate-300">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-3 pr-6">Nodo</th>
                      <th className="pb-3 pr-6">CPU %</th>
                      <th className="pb-3 pr-6">RAM (MB)</th>
                      <th className="pb-3 pr-6">Lectura (MB)</th>
                      <th className="pb-3">Escritura (MB)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodeRows.map(row => (
                      <tr key={row.ip} className="border-b border-slate-800/50 last:border-0">
                        <td className="py-3 pr-6 font-mono">{row.ip}</td>
                        <td className="py-3 pr-6">{row.cpu.toFixed(1)}</td>
                        <td className="py-3 pr-6">{row.ram.toFixed(0)}</td>
                        <td className="py-3 pr-6">{row.read.toFixed(2)}</td>
                        <td className="py-3">{row.write.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-lg shadow-slate-950/20">
      <div className="mb-4 space-y-1">
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        <p className="text-sm text-slate-400">{description}</p>
      </div>
      {children}
    </section>
  );
}
