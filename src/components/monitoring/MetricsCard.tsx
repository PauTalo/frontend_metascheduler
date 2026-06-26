import type { ReactNode } from 'react';

interface Props {
  title: string;
  value: string | number;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'indigo' | 'gray';
  icon?: ReactNode;
}

const colorMap: Record<NonNullable<Props['color']>, string> = {
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  green: 'bg-green-50 border-green-200 text-green-700',
  yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  red: 'bg-red-50 border-red-200 text-red-700',
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  gray: 'bg-gray-50 border-gray-200 text-gray-700',
};

export function MetricsCard({ title, value, color = 'gray', icon }: Props) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1 ${colorMap[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">{title}</span>
        {icon && <span className="opacity-50">{icon}</span>}
      </div>
      <span className="text-3xl font-bold">{value}</span>
    </div>
  );
}
