import { useEffect, useState } from 'react';
import { clusterService, nodesService, statusService } from '../../api/cgroups.api';
import type { ApiStatus, Node, ClusterMode } from '../../types/job.types';
import { getNodeHealthLabel, getNodeHealthState } from '../../utils/nodeHealth';
import { Wifi, WifiOff } from 'lucide-react';

const modeLabels: Record<ClusterMode, string> = {
  best_effort: 'Best Effort',
  shared: 'Compartido',
  exclusive: 'Exclusivo',
  dynamic: 'Dinámico',
};

const modeColors: Record<ClusterMode, string> = {
  best_effort: 'bg-yellow-100 text-yellow-800',
  shared: 'bg-blue-100 text-blue-800',
  exclusive: 'bg-red-100 text-red-800',
  dynamic: 'bg-green-100 text-green-800',
};

export function ClusterStatus() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [masterId, setMasterId] = useState<number | null>(null);
  const [mode, setMode] = useState<ClusterMode | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);

  useEffect(() => {
    nodesService.getAll().then(setNodes).catch(() => {});
    nodesService.getMaster().then(master => setMasterId(master.id)).catch(() => {});
    clusterService.getMode().then(setMode).catch(() => {});
    statusService.get().then(setApiStatus).catch(() => setApiStatus(null));
  }, []);

  const alive = nodes.filter(node => getNodeHealthState(node.is_alive) === 'alive').length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Estado del clúster
      </h3>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-sm text-gray-600">API:</span>
        {apiStatus ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            {apiStatus.status}
          </span>
        ) : (
          <span className="text-xs text-gray-400">no disponible</span>
        )}
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-sm text-gray-600">Política activa:</span>
        {mode ? (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${modeColors[mode]}`}>
            {modeLabels[mode]}
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </div>

      {apiStatus && (
        <div className="text-sm text-gray-600 mb-2">
          Backend con privilegios root: <span className="font-semibold">{apiStatus.root ? 'sí' : 'no'}</span>
        </div>
      )}

      <div className="text-sm text-gray-600 mb-2">
        Nodos: <span className="font-semibold">{alive}/{nodes.length}</span> activos
      </div>

      <div className="flex flex-col gap-1">
        {nodes.map(node => {
          const healthState = getNodeHealthState(node.is_alive);
          const healthLabel = getNodeHealthLabel(node.is_alive);
          const healthClasses =
            healthState === 'alive'
              ? 'bg-green-100 text-green-700'
              : healthState === 'down'
                ? 'bg-red-100 text-red-600'
                : 'bg-amber-100 text-amber-700';

          return (
            <div key={node.id} className="flex items-center gap-2 text-xs text-gray-500">
              {healthState === 'alive' ? (
                <Wifi size={12} className="text-green-500" />
              ) : healthState === 'down' ? (
                <WifiOff size={12} className="text-red-400" />
              ) : (
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-400" />
              )}
              <span>{node.ip}:{node.port}</span>
              {node.id === masterId && (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700">
                  Maestro
                </span>
              )}
              <span className={`ml-auto rounded-full px-2 py-0.5 font-medium ${healthClasses}`}>
                {healthLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
