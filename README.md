# Metascheduler Frontend

Frontend en React + TypeScript + Vite para operar contra la API HTTP de Metascheduler.

## Alcance

- Dashboard con resumen de trabajos.
- Monitor de trabajos con filtrado y eliminación de pendientes.
- Formulario de envío de trabajos.
- Vista de rendimiento basada en snapshots del frontend.
- Configuración del modo de clúster.
- Inicio de sesión ligero basado en usuario almacenado en Zustand.

## Requisitos

- Node.js 18 o superior.
- API de Metascheduler disponible.

## Variables de entorno

Crea o ajusta `.env.development` con:

```env
VITE_METASCHEDULER_API_URL=/api
VITE_METASCHEDULER_API_PROXY_TARGET=http://localhost:8000
```

En desarrollo, Vite hace proxy de `/api` al backend real para evitar errores CORS del navegador.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run lint
npm run preview
```

## Estructura principal

```text
src/
  api/                Cliente y servicios CGroups
  components/         Layout y tarjetas de monitorización
  hooks/              Polling y acceso a trabajos
  pages/              Pantallas protegidas y login
  store/              Auth y snapshots de métricas
  types/              Tipos de trabajos y métricas
```

## Backend esperado

La capa `src/api/cgroups.api.ts` consume estos endpoints:

- `GET /status`
- `GET /jobs?owner=...&status=...&queue=...`
- `GET /jobs/:id?owner=...`
- `POST /jobs`
- `PUT /jobs/:id?owner=...`
- `DELETE /jobs/:id?owner=...`
- `GET /cluster/mode`
- `PUT /cluster/mode`
- `GET /cluster/nodes`
- `GET /cluster/nodes/master`
- `GET /cluster/nodes/:id`
- `GET /queues`
