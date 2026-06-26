import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { jobsService } from '../../api/cgroups.api';
import {
  sshJobsService,
  SshAuthError,
  type JobUpdateChanges,
  type JobUpdateResult,
} from '../../api/auth.api';
import type { Job, Queue, SchedulerType } from '../../types/job.types';
import { normalizeUserName, useAuthStore } from '../../store/authStore';

const schema = z.object({
  name: z.string().min(1, 'Nombre requerido').regex(/^\S+$/, 'El nombre no puede contener espacios'),
  path: z.string().min(1, 'Ruta del script requerida'),
  options: z.string(),
  queue: z.coerce.number().int().positive('Selecciona una cola válida'),
  sessionPassword: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function resolveSchedulerType(queue: Queue | undefined): SchedulerType | null {
  const schedulerName = queue?.scheduler_name.toLowerCase() ?? '';
  if (schedulerName.includes('hadoop')) return 'H';
  if (schedulerName.includes('sge')) return 'S';
  return null;
}

interface Props {
  job: Job;
  queues: Queue[];
  onClose: () => void;
  onUpdated: () => void;
}

// only sends the changed fields to the SSH sidecar, which re-checks path perms before applying
export function JobEditModal({ job, queues, onClose, onUpdated }: Props) {
  const { user } = useAuthStore();
  const currentUser = normalizeUserName(user) ?? '';
  const [loading, setLoading] = useState(true);
  const [original, setOriginal] = useState<Job>(job);

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: {
      name: job.name,
      path: job.path,
      options: job.options,
      queue: job.queue,
      sessionPassword: '',
    },
  });

  useEffect(() => {
    let active = true;
    jobsService
      .getById(job.id_, currentUser)
      .then(fresh => {
        if (!active) return;
        setOriginal(fresh);
        form.reset({
          name: fresh.name,
          path: fresh.path,
          options: fresh.options,
          queue: fresh.queue,
          sessionPassword: '',
        });
      })
      .catch(() => {
        // if the reload fails, keep the row we already have as the base
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedQueue = queues.find(q => q.id === Number(form.watch('queue')));
  const schedulerType = resolveSchedulerType(selectedQueue);

  const handleResult = (result: JobUpdateResult) => {
    if (result.status === 'updated') {
      toast.success(result.message);
      onUpdated();
      onClose();
      return;
    }
    if (result.status === 'auth_failed') {
      toast.error('Credenciales inválidas. Revisa tu contraseña SSH.');
      return;
    }
    toast.error(result.message);
  };

  const onSubmit = async (data: FormValues) => {
    if (!schedulerType) {
      toast.error('No se pudo resolver el scheduler de la cola seleccionada');
      return;
    }

    const changes: JobUpdateChanges = {};
    if (data.name !== original.name) changes.name = data.name;
    if (data.path !== original.path) changes.path = data.path;
    if (data.options !== original.options) changes.options = data.options;
    if (Number(data.queue) !== original.queue) changes.queue = Number(data.queue);

    if (Object.keys(changes).length === 0) {
      toast('No hay cambios que guardar');
      onClose();
      return;
    }

    if (!data.sessionPassword) {
      form.setError('sessionPassword', { message: 'Contraseña requerida' });
      return;
    }

    try {
      const result = await sshJobsService.update({
        user: currentUser,
        password: data.sessionPassword,
        jobId: original.id_,
        path: data.path,
        pwd: original.pwd,
        scheduler_type: schedulerType,
        changes,
      });
      handleResult(result);
    } catch (err) {
      toast.error(err instanceof SshAuthError ? err.message : 'Error al contactar con el servicio SSH');
    }
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">Editar trabajo #{original.id_}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Cerrar">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">Cargando datos del trabajo…</p>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Field label="Nombre del trabajo" error={form.formState.errors.name?.message}>
              <input {...form.register('name')} className={input()} placeholder="job_name (sin espacios)" />
            </Field>

            <Field label="Directorio de trabajo">
              <div className={inputReadonly()}>{original.pwd || '—'}</div>
            </Field>

            <Field label="Ruta del script" error={form.formState.errors.path?.message}>
              <input {...form.register('path')} className={input()} placeholder="job.sh" />
            </Field>

            <Field label="Opciones (opcional)">
              <input {...form.register('options')} className={input()} placeholder="wordcount test.txt out1" />
            </Field>

            <Field label="Tipo de scheduler detectado">
              <div className={inputReadonly()}>
                {schedulerType === 'S' && 'SGE (S)'}
                {schedulerType === 'H' && 'Hadoop (H)'}
                {!schedulerType && 'Selecciona una cola válida'}
              </div>
            </Field>

            <Field label="Cola" error={form.formState.errors.queue?.message}>
              <select {...form.register('queue')} className={input()}>
                {queues.length === 0 ? (
                  <option value="">No hay colas disponibles</option>
                ) : (
                  queues.map(q => (
                    <option key={q.id} value={q.id}>
                      {q.scheduler_name} (ID {q.id})
                    </option>
                  ))
                )}
              </select>
            </Field>

            <Field label="Contraseña SSH" error={form.formState.errors.sessionPassword?.message}>
              <input
                {...form.register('sessionPassword')}
                type="password"
                className={input()}
                placeholder="Contraseña SSH"
              />
            </Field>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !schedulerType}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSubmitting ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function input() {
  return 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
}

function inputReadonly() {
  return 'w-full rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-500';
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wide text-gray-600">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
