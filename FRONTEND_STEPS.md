# FRONTEND_STEPS

> Roadmap del frontend centrado exclusivamente en CGroups.

## Completado

- [x] Cliente Axios único para CGroups.
- [x] Rutas protegidas con login básico.
- [x] Dashboard con resumen de trabajos.
- [x] Monitor con filtros por estado y tipo.
- [x] Envío de trabajos mediante formulario validado con Zod.
- [x] Configuración del modo de clúster.
- [x] Limpieza de la antigua ruta comparativa y de la API duplicada.
- [x] Monitoreo de estado de nodos con tri-state (`alive`, `down`, `unknown`).
- [x] Utilitarios compartidos para validación de estado de salud de nodos en `src/utils/nodeHealth.ts`.
- [x] Componente `ClusterStatus` mostrando salud de nodos con color-coding.

## Pendiente a corto plazo

- [ ] Añadir refresco inmediato tras crear o eliminar trabajos, además del polling.
- [ ] Mejorar la vista de rendimiento con métricas del backend si existe endpoint dedicado.
- [ ] Añadir estados vacíos y de error más informativos en todas las páginas.
- [ ] Incorporar pruebas para hooks y páginas críticas.

## Pendiente a medio plazo

- [ ] Persistir configuración relevante de usuario más allá de la sesión actual.
- [ ] Añadir control de permisos para operaciones administrativas.
- [ ] Automatizar build y lint en CI.
- [ ] Preparar despliegue con fallback SPA para rutas protegidas.

## Criterios de cierre

- [x] El frontend compila con `npm run build`.
- [x] El lint queda limpio.
- [x] Toda la documentación describe exclusivamente el flujo CGroups.
- [ ] Todas las páginas manejan correctamente estados de error y vacío.
- [ ] Tests unitarios para hooks críticos (`useJobs`, `usePolling`) con cobertura ≥80%.
