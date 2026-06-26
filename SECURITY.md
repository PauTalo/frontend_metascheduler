# Seguridad del frontend del Metascheduler

Documento de análisis y endurecimiento de seguridad. Sirve a la vez como
sección de seguridad de la memoria del TFG y como guía de despliegue.

## 1. Alcance y superficie de ataque

El sistema desplegado tiene tres componentes:

| Componente | Tecnología | Exposición | Riesgo |
|------------|-----------|------------|--------|
| SPA (React/Vite) | Estático servido al navegador | Público | Bajo: no guarda secretos; toda la lógica sensible está en el backend/sidecar |
| **Sidecar SSH** (`ssh-auth-sidecar/`) | Node.js + `ssh2` | Red interna / proxy | **Alto: recibe usuario+contraseña por HTTP y abre sesiones SSH reales al cluster** |
| API Metascheduler | FastAPI | Red interna | Fuera del alcance de este TFG (no se modifica) |

**Conclusión clave:** el SPA no es el activo crítico. Las variables `VITE_*` se
empaquetan en el bundle y son **públicas por diseño**, así que no contienen
secretos (solo URLs y el nombre del usuario admin). El componente que un
atacante intentaría explotar es el **sidecar**, porque es, en la práctica, un
proxy de autenticación SSH expuesto por HTTP.

### 1.1 Categorías de seguridad y alcance

Conviene distinguir tres planos distintos, porque este trabajo no cubre los tres
por igual:

| Plano | Qué cubre | Cómo se aborda aquí | Estado |
|-------|-----------|---------------------|--------|
| **Seguridad de código** (app security) | Vulnerabilidades en el propio código: inyección, XSS, secretos hardcodeados, dependencias vulnerables | Validación de entradas y escapado anti-inyección en el sidecar; verificación con `npm audit` y SAST (Semgrep/CodeQL) | Cubierto |
| **Seguridad en runtime** (capa de aplicación, L7) | Abusos del servicio en marcha: fuerza bruta, DoS por endpoint, inundación de peticiones, CORS, credenciales en claro | Rate limiting por IP, lista blanca de CORS, límite de tamaño de cuerpo, TLS en despliegue | **Cubierto — es el grueso de este trabajo** |
| **Seguridad de red** (volumétrica, L3/L4) | DoS/DDoS de ancho de banda, SYN flood | — | **Fuera de alcance**: requiere WAF, balanceador, `fail2ban` o anti-DDoS de infraestructura |

El endurecimiento que se implementa vive sobre todo en el **plano de runtime a
nivel de aplicación**, que es el que motivó el trabajo (servidores expuestos a
fuerza bruta y abuso de peticiones). La **seguridad de código** se cubre con la
validación ya presente más el procedimiento de verificación (§3). La **DoS
volumétrica de red** queda explícitamente fuera de alcance: el rate limiting de
aquí es por IP y por endpoint (L7), no defiende contra saturación de ancho de
banda, que corresponde a la capa de infraestructura.

## 2. Modelo de amenazas (STRIDE) del sidecar

| # | Amenaza (STRIDE) | Vector | Mitigación implementada |
|---|------------------|--------|--------------------------|
| 1 | **Spoofing** — falsificar identidad | Declarar `owner` arbitrario en `POST /jobs` | El `owner` no viene del cuerpo: es el `username` de la sesión SSH, verificado por el protocolo SSH (`server.mjs`, paso de permisos antes del POST) |
| 2 | **Elevation of Privilege** — fuerza bruta de contraseñas SSH | `POST /auth/login` repetido con `curl` | **Rate limiting por IP en el servidor** (`createLoginGuard`): bloqueo tras `LOGIN_MAX_FAILS` fallos durante `LOGIN_LOCK_MS`. El throttling del navegador (`loginThrottle.ts`) queda solo como UX |
| 3 | **Tampering / Injection** — inyección de comandos shell | `path`/`pwd` maliciosos en el comando `test` ejecutado por SSH | `path`/`pwd` se insertan entre comillas simples con escapado (`'` → `'\''`); el `user` se valida con `USERNAME_PATTERN` (`^[a-zA-Z0-9._-]{1,64}$`); `scheduler_type` se restringe a `'S'`/`'H'` |
| 4 | **Tampering** — invitado lanza trabajo arbitrario | Editar el DOM o enviar un POST manipulado a `/jobs/launch-guest` | El endpoint ignora el cuerpo salvo `scheduler_type`; el resto sale de las variables `GUEST_*` del servidor (única fuente de verdad) |
| 5 | **Denial of Service** — saturar el cluster | Spam a `/jobs/launch-guest` (sin auth) | **Rate limiting por IP** (`createRateLimiter`): `GUEST_MAX_PER_MIN` por minuto |
| 6 | **Information Disclosure** — fuga de origen cruzado | Cualquier web llamando al sidecar (`Access-Control-Allow-Origin: *`) | **Lista blanca de CORS** vía `SSH_AUTH_ALLOW_ORIGIN`; en producción se fija el dominio real |
| 7 | **Information Disclosure** — credenciales en claro en la red | Sniffing del tráfico HTTP usuario↔sidecar | Desplegar el sidecar **siempre detrás de un reverse proxy con TLS** (ver §4); las contraseñas nunca se persisten (viajan solo en la petición puntual) |
| 8 | **Repudiation** — falta de trazabilidad | — | El sidecar registra cada intento con usuario, endpoint y outcome (sin contraseñas) |
| 9 | **DoS** — cuerpos de petición enormes | POST con body gigante | `readJsonBody` limita el tamaño (4 KB / 16 KB según endpoint) |

## 3. Cómo comprobar la seguridad (reproducible)

### 3.1 Análisis de dependencias
```bash
npm audit                      # raíz (frontend)
cd ssh-auth-sidecar && npm audit
```

### 3.2 Análisis estático (SAST)
```bash
npm run lint
# Opcional, más exhaustivo:
npx semgrep --config p/javascript --config p/nodejs .
```

### 3.3 Pruebas dinámicas dirigidas contra el sidecar
Verifican las mitigaciones 2, 5 y 6 sin pasar por el navegador (que es justo lo
que haría un atacante):

```bash
# Fuerza bruta: tras LOGIN_MAX_FAILS intentos debe devolver 429
for i in $(seq 1 8); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:4000/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"user":"pau","password":"incorrecta"}'
done
# Esperado: 200,200,200,200,200,429,429,429

# DoS de invitado: tras GUEST_MAX_PER_MIN debe devolver 429
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:4000/jobs/launch-guest \
    -H 'Content-Type: application/json' -d '{"scheduler_type":"S"}'
done

# Inyección de comandos: el path malicioso NO debe ejecutar nada;
# debe resolverse como "path inexistente" / permiso denegado, no como shell
curl -s -X POST http://localhost:4000/jobs/launch \
  -H 'Content-Type: application/json' \
  -d '{"user":"pau","password":"...","name":"x","queue":1,"scheduler_type":"S","pwd":"/tmp","path":"/tmp/a.sh; touch /tmp/PWNED #"}'
# Verificar después que /tmp/PWNED NO existe
```

### 3.4 Escaneo automático (DAST)
Levantar frontend + sidecar y pasar **OWASP ZAP** en modo automático sobre la
URL. Revisar cabeceras de seguridad faltantes y CORS.

### 3.5 Cabeceras de seguridad
Pasar la URL desplegada por <https://securityheaders.com> y comprobar CSP,
HSTS, X-Frame-Options en el reverse proxy.

## 4. Recomendaciones de despliegue

1. **TLS obligatorio**: el sidecar nunca debe exponerse en HTTP plano. Ponerlo
   detrás de nginx/traefik con certificado, y `TRUST_PROXY=true` para que el
   rate limiting use la IP real (`X-Forwarded-For`).
2. **CORS cerrado**: `SSH_AUTH_ALLOW_ORIGIN=https://<dominio-del-frontend>`.
3. **Red mínima**: el sidecar solo necesita alcanzar el cluster (SSH) y la API;
   no debe ser accesible desde fuera salvo a través del proxy del frontend.
4. **Cabeceras** (en el reverse proxy): `Strict-Transport-Security`,
   `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.

## 5. Configuración relevante (variables de entorno del sidecar)

| Variable | Defecto | Propósito |
|----------|---------|-----------|
| `SSH_AUTH_ALLOW_ORIGIN` | `*` | Lista blanca de orígenes CORS (coma-separada) |
| `LOGIN_MAX_FAILS` | `5` | Fallos de credenciales por IP antes de bloquear |
| `LOGIN_LOCK_MS` | `900000` | Duración del bloqueo (15 min) |
| `GUEST_MAX_PER_MIN` | `10` | Lanzamientos de invitado por IP y minuto |
| `TRUST_PROXY` | `false` | Leer la IP de `X-Forwarded-For` (solo tras un proxy de confianza) |

## 6. Limitaciones conocidas

- El estado de los límites es **en memoria de un solo proceso**. Con varias
  réplicas del sidecar habría que centralizarlo (p. ej. Redis).
- El rate limiting es por IP; un atacante con muchas IPs (botnet) lo diluye.
  Para ese escenario se necesitaría además fail2ban a nivel de host o un WAF.
