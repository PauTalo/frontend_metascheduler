# ssh-auth-sidecar

Servicio HTTP mínimo que valida usuarios del cluster vía SSH para el login del frontend de Metascheduler.

El navegador no puede abrir conexiones SSH, así que este sidecar recibe un usuario por HTTP, intenta `ssh <user>@<host>` con una clave privada y responde si el usuario existe.

## Funcionamiento

`POST /auth/login` con cuerpo `{ "user": "<usuario>" }`:

- Conexión SSH establecida → `200 { "exists": true, "user": "<usuario>" }`
- Autenticación rechazada (usuario no válido) → `200 { "exists": false }`
- Cluster inalcanzable → `502 { "error": "cluster_unreachable" }`

`GET /health` → `200 { "status": "ok" }`

La autenticación la resuelve la clave privada configurada; **no se pide contraseña al usuario**.

### `POST /jobs/launch-guest` — trabajo fijo del invitado

Lanza uno de los dos trabajos predefinidos del invitado (SGE o Hadoop) **sin SSH
y sin contraseña**. Del cuerpo solo se lee `scheduler_type` (`S` o `H`); el resto
de campos se **ignoran**: el sidecar construye el `POST /jobs` con su config
`GUEST_*` para el tipo elegido.

Body: `{ "scheduler_type": "S" | "H" }`

> ⚠️ **Por qué solo se acepta el tipo:** prefijar los campos en el formulario es
> solo cosmético. Un invitado podría abrir las DevTools del navegador y enviar un
> POST manipulado (con otro `owner`/`path`/`options`). Por eso lo único que el
> cliente controla es el tipo de scheduler; el resto sale de las variables
> `GUEST_*` del servidor, la única fuente de la verdad del prefijado.

- Trabajo registrado → `200 { "message": "Trabajo enviado (JOB_ID=...)" }`
- `scheduler_type` ausente o inválido → `400 { "error": "invalid_scheduler_type" }`
- Mal configurado (faltan `GUEST_*` del tipo) → `500 { "error": "guest_misconfigured" }`
- Error de la API → `500 { "error": "launch_error" }`

## Configuración

Copia `.env.example` a `.env` y ajusta los valores (o expórtalos como variables de entorno):

| Variable               | Descripción                                              |
| ---------------------- | -------------------------------------------------------- |
| `SSH_AUTH_PORT`        | Puerto HTTP del sidecar (por defecto `4000`).            |
| `SSH_HOST` / `SSH_PORT`| Host y puerto SSH del cluster.                           |
| `SSH_PRIVATE_KEY_PATH` | Ruta a la clave privada (obligatoria).                   |
| `SSH_PASSPHRASE`       | Passphrase de la clave (opcional).                       |
| `SSH_READY_TIMEOUT`    | Timeout en ms para considerar el cluster inalcanzable.   |
| `SSH_AUTH_ALLOW_ORIGIN`| Origen CORS permitido (`*` en dev).                      |
| `GUEST_OWNER`          | Cuenta fija (compartida) de los trabajos de invitado.    |
| `GUEST_SGE_NAME`       | Nombre del trabajo SGE de invitado.                      |
| `GUEST_SGE_PATH`       | Ruta del script del trabajo SGE.                         |
| `GUEST_SGE_PWD`        | Directorio de trabajo del trabajo SGE.                   |
| `GUEST_SGE_QUEUE`      | ID de cola (entero) del trabajo SGE.                     |
| `GUEST_SGE_OPTIONS`    | Opciones opcionales del trabajo SGE.                     |
| `GUEST_HADOOP_NAME`    | Nombre del trabajo Hadoop de invitado.                   |
| `GUEST_HADOOP_PATH`    | Ruta del jar/script del trabajo Hadoop.                  |
| `GUEST_HADOOP_PWD`     | Directorio de trabajo del trabajo Hadoop.                |
| `GUEST_HADOOP_QUEUE`   | ID de cola (entero) del trabajo Hadoop.                  |
| `GUEST_HADOOP_OPTIONS` | Opciones opcionales del trabajo Hadoop.                  |

> Las variables `GUEST_SGE_*` admiten fallback a las antiguas `GUEST_NAME`/`GUEST_PATH`/… (trabajo SGE) si no están definidas.

## Uso

```bash
cd ssh-auth-sidecar
npm install
# carga las variables de entorno (.env) en tu shell y arranca:
npm start
```

En desarrollo, Vite hace proxy de `/ssh-auth` del frontend a este servicio (ver `vite.config.ts`).
