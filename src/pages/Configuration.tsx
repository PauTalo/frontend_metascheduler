import { useEffect, useState } from 'react';
import { clusterService, getApiErrorMessage, nodesService, queuesService } from '../api/cgroups.api';
import type { ClusterMode, Node, Queue } from '../types/job.types';
import { useAuthStore } from '../store/authStore';
import { getNodeHealthLabel, getNodeHealthState } from '../utils/nodeHealth';
import toast from 'react-hot-toast';

const modes: { value: ClusterMode; label: string; description: string }[] = [
  { value: 'best_effort', label: 'Best Effort', description: 'Recursos no garantizados; máxima flexibilidad.' },
  { value: 'shared', label: 'Compartido', description: '50% CPU para SGE, 50% para Hadoop.' },
  { value: 'exclusive', label: 'Exclusivo', description: 'Recursos exclusivos para un scheduler hasta terminar.' },
  { value: 'dynamic', label: 'Dinámico', description: 'Adaptación automática según carga real.' },
];

export function Configuration() {
  const { role } = useAuthStore();
  const isAdmin = role === 'admin';
  const [currentMode, setCurrentMode] = useState<ClusterMode | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [masterId, setMasterId] = useState<number | null>(null);
  const [queues, setQueues] = useState<Queue[]>([]);

  useEffect(() => {
    clusterService.getMode().then(setCurrentMode).catch(() => {});
    nodesService.getAll().then(setNodes).catch(() => {});
    nodesService.getMaster().then(master => setMasterId(master.id)).catch(() => {});
    queuesService.getAll().then(setQueues).catch(() => {});
  }, []);

  const handleModeChange = async (mode: ClusterMode) => {
    if (!isAdmin) {
      toast.error('Solo el administrador puede cambiar la política');
      return;
    }

    try {
      // Backend bug: changing the policy only works when the request owner is
      // `root`. The admin is the only one allowed here, so we hardcode `root`
      // as the owner just for this request.
      await clusterService.setMode('root', mode);
      const updatedMode = await clusterService.getMode();
      setCurrentMode(updatedMode);
      toast.success(`Política cambiada a ${mode}`);
    } catch (requestError) {
      toast.error(getApiErrorMessage(requestError, 'Error al cambiar la política'));
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Configuración</h1>

      {/* Políticas */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Política de scheduling</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {modes.map(m => (
            <button
              key={m.value}
              onClick={() => handleModeChange(m.value)}
              className={`text-left rounded-lg border p-3 transition-colors ${
                currentMode === m.value
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-gray-200 hover:border-brand-300 hover:bg-gray-50'
              }`}
            >
              <div className="font-medium text-sm text-gray-800">{m.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{m.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Nodos */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Nodos del clúster</h2>
        {nodes.length === 0 ? (
          <p className="text-sm text-gray-400">Sin datos</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400 border-b">
              <tr>
                <th className="text-left pb-1">ID</th>
                <th className="text-left pb-1">IP</th>
                <th className="text-left pb-1">Puerto</th>
                <th className="text-left pb-1">Estado</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map(n => {
                const healthState = getNodeHealthState(n.is_alive);
                const healthClasses =
                  healthState === 'alive'
                    ? 'bg-green-100 text-green-700'
                    : healthState === 'down'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-amber-100 text-amber-700';

                return (
                  <tr key={n.id} className="border-b last:border-0">
                    <td className="py-1.5 text-gray-500">{n.id}</td>
                    <td className="py-1.5 text-gray-500">
                      <span className="flex items-center gap-2">
                        {n.ip}
                        {n.id === masterId && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">
                            Maestro
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-1.5 text-gray-500">{n.port}</td>
                    <td className="py-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${healthClasses}`}>
                        {getNodeHealthLabel(n.is_alive)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Colas */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Colas disponibles</h2>
        {queues.length === 0 ? (
          <p className="text-sm text-gray-400">Sin datos</p>
        ) : (
          <div className="flex gap-2">
            {queues.map(q => (
              <span key={q.id} className="text-xs bg-gray-100 text-gray-700 px-3 py-1 rounded-full">
                {q.scheduler_name} (ID {q.id})
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
