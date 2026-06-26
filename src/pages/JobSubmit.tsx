import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { queuesService } from '../api/cgroups.api';
import { sshJobsService, SshAuthError } from '../api/auth.api';
import type { Queue, SchedulerType } from '../types/job.types';
import { normalizeUserName, useAuthStore } from '../store/authStore';
import { getGuestJobInfo, type GuestSchedulerType } from '../utils/guestJob';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const sshSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').regex(/^\S+$/, 'El nombre no puede contener espacios'),
  path: z.string().min(1, 'Ruta del script requerida'),
  pwd: z.string().min(1, 'Directorio de trabajo requerido'),
  options: z.string(),
  queue: z.coerce.number().int().positive('Selecciona una cola válida'),
  sessionPassword: z.string().min(1, 'Contraseña requerida'),
});

type SshFormValues = z.infer<typeof sshSchema>;

function resolveSchedulerType(queue: Queue | undefined): SchedulerType | null {
  const schedulerName = queue?.scheduler_name.toLowerCase() ?? '';
  if (schedulerName.includes('hadoop')) return 'H';
  if (schedulerName.includes('sge')) return 'S';
  return null;
}

function handleResult(result: Awaited<ReturnType<typeof sshJobsService.launch>>, navigate: (to: string, opts?: object) => void) {
  if (result.status === 'submitted') { toast.success(result.message); navigate('/monitor', { replace: true }); return; }
  if (result.status === 'permission_denied') { toast.error(result.message); return; }
  if (result.status === 'auth_failed') { toast.error('Credenciales expiradas. Cierra sesión y vuelve a entrar.'); return; }
  if (result.status === 'unreachable') { toast.error(result.message); return; }
  toast.error(result.message);
}

export function JobSubmit() {
  const { role } = useAuthStore();
  if (role === 'guest') return <GuestJobSubmit />;
  return <SshJobSubmit />;
}

// Invitado: sin SSH ni contraseña. Los campos son de solo lectura; el botón
// llama a /jobs/launch-guest y el sidecar impone los valores fijos del servidor
// (manipular el formulario o el POST no cambia el trabajo que se lanza).
function GuestJobSubmit() {
  const navigate = useNavigate();
  const [schedulerType, setSchedulerType] = useState<GuestSchedulerType>('S');
  const [submitting, setSubmitting] = useState(false);

  const guest = getGuestJobInfo(schedulerType);

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await sshJobsService.launchGuest(schedulerType);
      if (result.status === 'submitted') {
        toast.success(result.message);
        navigate('/monitor', { replace: true });
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof SshAuthError ? err.message : 'Error al contactar con el servicio SSH');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <h1 className="text-xl font-bold text-slate-100">Lanzar trabajo de invitado</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-8 space-y-4">
        <p className="text-xs text-gray-500">
          Como invitado lanzas un trabajo predefinido. Elige el tipo de scheduler; el resto de
          valores los fija el servidor según el tipo y no se piden credenciales.
        </p>

        <Field label="Tipo de scheduler">
          <select
            value={schedulerType}
            onChange={e => setSchedulerType(e.target.value as GuestSchedulerType)}
            disabled={submitting}
            className={input()}
          >
            <option value="S">SGE (S)</option>
            <option value="H">Hadoop (H)</option>
          </select>
        </Field>

        <Field label="Nombre del trabajo">
          <div className={inputReadonly()}>{guest.name}</div>
        </Field>

        <Field label="Owner">
          <div className={inputReadonly()}>{guest.owner}</div>
        </Field>

        <Field label="Ruta del script">
          <div className={inputReadonly()}>{guest.path || '—'}</div>
        </Field>

        <Field label="Directorio de trabajo">
          <div className={inputReadonly()}>{guest.pwd || '—'}</div>
        </Field>

        <Field label="Opciones">
          <div className={inputReadonly()}>{guest.options || '—'}</div>
        </Field>

        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {submitting ? 'Enviando…' : 'Enviar trabajo'}
        </button>
      </div>
    </div>
  );
}

function SshJobSubmit() {
  const { user, pwd: storedPwd } = useAuthStore();
  const navigate = useNavigate();
  const [queues, setQueues] = useState<Queue[]>([]);
  const currentUser = normalizeUserName(user) ?? '';
  const currentHome = storedPwd ?? `/home/${currentUser}/`;

  const sshForm = useForm<SshFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(sshSchema) as any,
    defaultValues: { pwd: currentHome, options: '', sessionPassword: '' },
  });

  const selectedQueueId = sshForm.watch('queue');
  const selectedQueue = queues.find(q => q.id === Number(selectedQueueId));
  const selectedSchedulerType = resolveSchedulerType(selectedQueue);

  useEffect(() => {
    queuesService
      .getAll()
      .then(data => {
        setQueues(data);
        if (data.length > 0) {
          sshForm.setValue('queue', data[0].id, { shouldValidate: true });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSshSubmit = async (data: SshFormValues) => {
    const queue = queues.find(item => item.id === data.queue);
    const schedulerType = resolveSchedulerType(queue);
    if (!schedulerType) { toast.error('No se pudo resolver el scheduler de la cola seleccionada'); return; }
    try {
      const result = await sshJobsService.launch({
        user: currentUser,
        password: data.sessionPassword,
        name: data.name,
        queue: data.queue,
        path: data.path,
        pwd: data.pwd,
        options: data.options,
        scheduler_type: schedulerType,
      });
      handleResult(result, navigate);
    } catch (err) {
      toast.error(err instanceof SshAuthError ? err.message : 'Error al contactar con el servicio SSH');
    }
  };

  const isSubmitting = sshForm.formState.isSubmitting;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <h1 className="text-xl font-bold text-slate-100">Lanzar nuevo trabajo</h1>

      <form onSubmit={sshForm.handleSubmit(onSshSubmit)} className="rounded-xl border border-gray-200 bg-white p-8 space-y-4">
        <Field label="Nombre del trabajo" error={sshForm.formState.errors.name?.message}>
          <input {...sshForm.register('name')} className={input()} placeholder="job_name (sin espacios)" />
        </Field>

        <Field label="Owner">
          <div className={inputReadonly()}>{currentUser}</div>
        </Field>

        <Field label="Ruta del script" error={sshForm.formState.errors.path?.message}>
          <input {...sshForm.register('path')} className={input()} placeholder="job.sh" />
        </Field>

        <Field label="Directorio de trabajo" error={sshForm.formState.errors.pwd?.message}>
          <input {...sshForm.register('pwd')} className={input()} placeholder={currentHome} />
        </Field>

        <Field label="Opciones (opcional)">
          <input {...sshForm.register('options')} className={input()} placeholder="wordcount test.txt out1" />
        </Field>

        <Field label="Tipo de scheduler detectado">
          <div className={inputReadonly()}>
            {selectedSchedulerType === 'S' && 'SGE (S)'}
            {selectedSchedulerType === 'H' && 'Hadoop (H)'}
            {!selectedSchedulerType && 'Selecciona una cola válida'}
          </div>
        </Field>

        <Field label="Cola" error={sshForm.formState.errors.queue?.message}>
          <select {...sshForm.register('queue')} className={input()}>
            {queues.length === 0 ? (
              <option value="">No hay colas disponibles</option>
            ) : (
              queues.map(q => (
                <option key={q.id} value={q.id}>{q.scheduler_name} (ID {q.id})</option>
              ))
            )}
          </select>
        </Field>

        <Field label="Contraseña SSH" error={sshForm.formState.errors.sessionPassword?.message}>
          <input {...sshForm.register('sessionPassword')} type="password" className={input()} placeholder="Contraseña SSH" />
        </Field>

        <SubmitButton disabled={isSubmitting || queues.length === 0 || !selectedSchedulerType} isSubmitting={isSubmitting} />
      </form>
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
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function SubmitButton({ disabled, isSubmitting }: { disabled: boolean; isSubmitting: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
    >
      {isSubmitting ? 'Enviando…' : 'Enviar trabajo'}
    </button>
  );
}
