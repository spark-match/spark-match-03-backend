# Runbook — Spark Match Backend (Identity context)

> Procedimientos operacionales para deploy, rollback, migraciones,
> rotacin de secretos, smoke tests y disaster recovery.
>
> Para diagnstico de errores ver [error-catalog.md](./error-catalog.md).
> Para RBAC/JWT troubleshooting ver [auth-rbac.md](./auth-rbac.md).

Last reviewed: 2026-07-28.

**Ambientes**:

| Nombre    | Stack name                 | Region      | S3 bucket                        | Notas                        |
| --------- | -------------------------- | ----------- | -------------------------------- | ---------------------------- |
| `dev`     | `spark-match-backend-dev`  | `us-east-1` | `spark-match-sam-artifacts-dev`  | non-VPC                      |
| `staging` | (manual)                   | `us-east-1` | (manual)                         | VPC                          |
| `prod`    | `spark-match-backend-prod` | `us-east-1` | `spark-match-sam-artifacts-prod` | VPC, `disable_rollback=true` |

`staging` no est en `samconfig.toml` an (gap conocido). Ver
[runbook.md § 8](#8-known-gaps).

---

## 1. Deploy

### 1.1 Build + deploy dev (no-VPC)

```bash
# Prereqs: AWS creds con SAM + Lambda + RDS + Secrets Manager + SSM perms
# en la cuenta de dev.

sam build --config-env default
sam deploy \
  --config-env default \
  --parameter-overrides "Environment=dev" \
  --no-confirm-changeset \
  --no-disable-rollback
```

### 1.2 Build + deploy staging (VPC)

```bash
sam build --config-env default
sam deploy \
  --config-env default \
  --parameter-overrides \
    "Environment=staging VpcSubnetIds=subnet-xxx,subnet-yyy VpcSecurityGroupIds=sg-zzz" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND
```

### 1.3 Build + deploy prod (VPC + no-rollback)

```bash
sam build --config-env prod
sam deploy --config-env prod --no-confirm-changeset
```

`prod` configura `disable_rollback=true` en `samconfig.toml`, **pero eso
solo aplica a un `sam deploy` a mano como el de arriba**. El pipeline
pasa `--no-disable-rollback` en la linea de comandos
([deploy.yml](../.github/workflows/deploy.yml)) y un flag explicito del
CLI gana sobre el fichero, asi que **por CI el rollback esta activo**.

Las dos rutas fallan de forma distinta, y conviene saber cual estas
usando antes de que falle:

| ruta                                    | rollback    | estado tras un fallo              | se puede reintentar?            |
| --------------------------------------- | ----------- | --------------------------------- | ------------------------------- |
| CI (`deploy.yml`)                       | activo      | `ROLLBACK_COMPLETE` en un CREATE  | **no**, hay que borrar la stack |
| manual (`sam deploy --config-env prod`) | desactivado | `CREATE_FAILED` / `UPDATE_FAILED` | si                              |

La ironia importa el dia del primer deploy: **`ROLLBACK_COMPLETE` no
admite update**. CloudFormation ve la stack existir, SAM emite un
changeset de tipo UPDATE y la respuesta es `is in ROLLBACK_COMPLETE
state and can not be updated`. Relanzar el workflow no arregla nada; hace
falta un `aws cloudformation delete-stack` a mano antes de reintentar. Le
paso a dev el 2026-08-05, que se borro y recreo cinco veces en una hora.

Ver § 2.

### 1.4 Verificacin post-deploy

Inmediatamente despus de cada deploy:

```bash
# 1. Listar outputs
aws cloudformation describe-stacks \
  --stack-name spark-match-backend-dev \
  --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}'

# 2. Smoke test (ver § 4)
API_URL=$(aws cloudformation describe-stacks \
  --stack-name spark-match-backend-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiUrl`].OutputValue' \
  --output text)

curl -sS -X POST "$API_URL/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.com","password":"smoke12345","fullName":"Smoke Test"}'
```

---

## 2. Rollback

### 2.1 Dev / staging (rollback automtico)

`samconfig.toml` tiene `disable_rollback = false` en default. Si el
deploy falla, SAM hace rollback al estado anterior. **No se requiere
accin manual** salvo que la stack quede en estado inconsistente.

### 2.2 Prod (solo si desplegaste A MANO)

Esta seccion aplica **unicamente al deploy manual**. Por CI el rollback
esta activo (§ 1.3) y CloudFormation revierte solo; lo que queda tras un
CREATE fallido es una stack en `ROLLBACK_COMPLETE` que hay que **borrar**,
no continuar:

```bash
aws cloudformation delete-stack --stack-name spark-match-backend-prod
aws cloudformation wait stack-delete-complete --stack-name spark-match-backend-prod
```

Para el caso manual, donde SAM **no** hace rollback, el procedimiento es:

**Opcin A — re-deploy del SHA anterior** (preferida):

```bash
# 1. Identificar el ltimo SHA bueno en main
git log --oneline -10 main

# 2. Crear rama temporal desde ese SHA
git checkout -b hotfix/rollback-X <sha>

# 3. Re-deploy con sam
sam build --config-env prod
sam deploy --config-env prod --no-confirm-changeset
```

**Opcin B — `continue-update-rollback`** (si la stack qued en
`UPDATE_ROLLBACK_FAILED`):

```bash
aws cloudformation continue-update-rollback \
  --stack-name spark-match-backend-prod
```

Si `continue-update-rollback` falla, la nica opcin es eliminar y
recrear la stack (puede causar prdida de data efmera; Aurora + S3 +
Secrets Manager son managed services, no se ven afectados).

### 2.3 La base de datos no se ve afectada

**No es Aurora.** `dev` y `prod` son instancias RDS PostgreSQL sueltas
(`spark-match-dev-db` y `spark-match-prod-db`, `db.t4g.micro`,
`MultiAZ=false`), no clusters Aurora. Importa porque cambia lo que se
puede hacer cuando algo va mal: no hay lectores, ni failover, ni
backtrack.

Y hoy tampoco hay copia de la que tirar: `BackupRetentionPeriod=0`, cero
snapshots y sin PITR. `DeletionProtection=true` impide borrar la
instancia, que no es lo mismo que poder recuperar una fila. Encender
retencion vive en `spark-match-02-infrastructure` y **tiene que estar
antes de la primera escritura de prod**, no despues.

Los datos viven en esa instancia (Terraform, aparte del stack de SAM).
Rollback del cdigo Lambda **no** toca la DB. Si la versin `N` de la
app introdujo una migracin `V00N`, hacer rollback a `N-1` no revierte
la migracin — usar `node-pg-migrate down` (§ 3).

---

## 3. Migraciones de DB

### 3.1 Listar migraciones aplicadas

```bash
aws lambda invoke \
  --function-name spark-match-identity-migrate-dev \
  --payload '{"direction":"status"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/migrate-status.json

cat /tmp/migrate-status.json | jq .
```

### 3.2 Aplicar migraciones pendientes (up)

```bash
aws lambda invoke \
  --function-name spark-match-identity-migrate-dev \
  --payload '{"direction":"up"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/migrate-up.json

cat /tmp/migrate-up.json | jq .
```

Response: `{ "direction": "up", "applied": ["V00N__..."], "log": [...] }`.

### 3.3 Revertir la ltima migracin (down)

```bash
aws lambda invoke \
  --function-name spark-match-identity-migrate-dev \
  --payload '{"direction":"down"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/migrate-down.json
```

**Advertencia**: `down` revierte la **ltima** migracin aplicada.
Requiere que el SQL tenga una seccin `DOWN` (no todas la tienen;
verificar antes de ejecutar).

### 3.4 IAM permissions necesarias

El caller (rol de CI/CD o dev workstation) requiere:

```
lambda:InvokeFunction on spark-match-identity-migrate-${env}
```

El Lambda tiene `SecretsManagerReadWrite` + `SSMParameterRead` para
resolver `MIGRATE_DATABASE_URL` y leer la secret de DB.

### 3.5 Convention: migraciones en deploy

Las migraciones se aplican **solas**, en el propio deploy. El paso
`apply-database-migrations` de `.github/workflows/deploy.yml` corre
justo despues de `sam deploy`, en el mismo job, y tumba el deploy si
una migracion falla o si queda alguna pendiente despues del `up`.

Los comandos de 3.1 a 3.3 siguen siendo validos para depurar o para un
`down`, pero en la operacion normal no hay que ejecutar nada a mano.

Dos cosas que conviene tener claras y que no son evidentes:

- **El paso no puede ir antes del deploy.** Los `.sql` viajan dentro
  del artefacto de la Lambda migradora, asi que invocarla antes de
  desplegar ejecuta el bundle viejo, que no conoce la migracion nueva
  y responde `{"applied":[]}`: exito aparente sin haber aplicado nada.
- **Queda una ventana corta e inevitable.** Entre que `sam deploy`
  termina y el paso de migraciones acaba, el codigo nuevo esta vivo
  contra el esquema viejo. No se puede cerrar reordenando; solo
  acortar, y por eso el paso va inmediatamente despues.

El job `migrations-dry-run` de `ci.yml` es **otra cosa** y no debe
confundirse con esto: valida el SQL contra un contenedor `postgres:17`
efimero en tiempo de PR, sin credenciales AWS y sin tocar RDS. Que
salga verde no significa que ninguna migracion se haya aplicado en
ningun entorno.

---

## 4. Smoke tests

Suite mnima de smoke tests para validar post-deploy. **No** son
integration tests (esos viven en `vitest`).

### 4.1 Register

```bash
EMAIL="smoke-$(date +%s)@example.com"
curl -sS -X POST "$API_URL/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"smoke12345\",\"fullName\":\"Smoke\"}" | jq .
```

Espera 200 con `{ id, email, fullName, createdAt }`. El `id` es UUID.

### 4.2 Login + JWT

```bash
RESP=$(curl -sS -X POST "$API_URL/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"smoke12345\"}")
TOKEN=$(echo "$RESP" | jq -r '.data.accessToken')
USER_ID=$(echo "$RESP" | jq -r '.data.user.id')
```

### 4.3 Get me

```bash
curl -sS "$API_URL/v1/users/me" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Espera 200 con `PublicUser` (sin `passwordHash`).

### 4.4 List users (admin)

```bash
curl -sS "$API_URL/v1/users" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Esto ya no es cierto y espera un 403.** Decia que `register` crea un
user con `role = 'admin'` por el DEFAULT de la 003. Desde la migracion
005 el alta publica crea `student`, y no por el DEFAULT de la columna:
`infra/user-repository.ts` escribe `role: DEFAULT_ROLE` explicitamente en
cada INSERT, con `DEFAULT_ROLE = SELF_REGISTRATION_ROLE = 'student'`. El
DEFAULT de la tabla no se consulta nunca.

Consecuencia para un entorno nuevo: **nace sin ningun administrador**, y
`/v1/users` y `/v1/audit` responden 403 a todo el mundo. No hay camino por
API para conceder el rol -- `handlers/update-user.ts` valida con
`UpdateProfileInputSchema`, que solo declara `fullName` y `age`, asi que
Zod descarta `role`; y `setRole` de `infra/user-repository.ts` no tiene
ningun llamador fuera de los tests.

La salida es una migracion que promueva una cuenta ya registrada, y tiene
que **afirmarse a si misma**: un `UPDATE ... WHERE email = '...'` que
toque 0 filas es indistinguible del exito en todas las capas
(node-pg-migrate marca la migracion como aplicada mire o no las filas
afectadas, el `status` posterior sale vacio y el deploy imprime "Sin
migraciones pendientes"). El patron correcto es un bloque `DO $$` que haga
`RAISE EXCEPTION` si no encontro la fila: como el runner corre en una sola
transaccion, el aborto se propaga y el gate de `FunctionError` del deploy
lo ve.

### 4.5 Negative: 401 sin auth

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$API_URL/v1/users/me"
# Espera: 401
```

---

## 5. Rotacin de secretos

### 5.1 JWT signing key

**Procedimiento** (ver [auth-rbac.md § 6](./auth-rbac.md)):

1. Generar nuevo secret (`openssl rand -base64 48`).
2. Crear nueva versin en Secrets Manager con el stage `AWSCURRENT`.
3. Esperar **hasta 5 minutos** (TTL del SSM cache) + 1 cold start.
4. JWTs firmados con el secret anterior **siguen siendo vlidos** hasta
   su `exp` (24 h). No hay revocacin forzada.

### 5.2 DB credentials

**Procedimiento** (Terraform-managed):

```bash
cd ../spark-match-02-infrastructure  # terraform repo
terraform apply -target=module.rds.aws_secretsmanager_secret_rotation
```

Secrets Manager rota automticamente; el ARN no cambia. Los Lambdas
leen el valor en cada invocacin (con cache de 5 min).

### 5.3 Audit log

`identity.audit_log` se escribe desde el service layer (PR #70,
ADR-015): 9 acciones, dentro de la misma transaccin que la mutacin de
`users`. **No rotar** — la tabla es append-only. Retention policy y
archive a S3 estn en el backlog (P2).

---

## 6. Disaster recovery

### 6.1 Aurora backup

Aurora Serverless v2 tiene **automated backups** (retention configurable
en Terraform, default 7 das). PITR (point-in-time recovery) hasta el
minuto.

**Restore**:

```bash
# Terraform-managed, no proceda manualmente
cd ../spark-match-02-infrastructure
terraform apply -target=module.rds.aws_rds_cluster_instance
```

### 6.2 Lambda code loss

Lambda code vive en S3 (`spark-match-sam-artifacts-${env}`). S3 tiene
versioning habilitado. **No hay prdida** salvo eliminacin explcita.

### 6.3 Config drift (SAM stack vs. Terraform)

Los stacks SAM y Terraform son **independientes**. Drift entre ellos
puede detectarse con:

```bash
aws cloudformation detect-drift \
  --stack-name spark-match-backend-dev
```

Drift tpico: VPC subnet IDs cambiadas en Terraform pero no re-deployadas
en SAM. Remediacin: `sam deploy` con los nuevos `VpcSubnetIds`.

---

## 7. Diagnstico

### 7.1 Logs

```bash
# Logs por Lambda (CloudWatch Insights)
aws logs tail /aws/lambda/spark-match-identity-login-dev --follow

# Application log (root stack)
aws logs tail /aws/spark-match/dev/application --follow
```

### 7.2 X-Ray traces

Console: https://console.aws.amazon.com/xray/home

Filtros tiles:

- `service("identity-register-dev")` — traces del register handler.
- `http.status >= 500` — errores 5xx.
- `annotation.userId = "<uuid>"` — traces por user.

### 7.3 CloudWatch metrics

Namespace `AWS/Lambda` para invocaciones. Namespace
`spark-match-backend` para custom metrics (Powertools). Ver
[observability.md](./observability.md).

### 7.4 Aurora performance

```bash
# Conexiones activas
aws rds describe-db-instances \
  --db-instance-identifier spark-match-aurora-dev \
  --query 'DBInstances[0].DBInstanceStatus'

# Query lenta (requiere Performance Insights habilitado)
aws pi describe-query-statistics \
  --service-type RDS \
  --identifier db-XXX \
  --start-time $(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%S') \
  --end-time $(date -u '+%Y-%m-%dT%H:%M:%S')
```

---

## 8. Known gaps

| Gap                                                           | Severidad | Tracking                                                                                                                                                   |
| ------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staging` no en `samconfig.toml`                              | P1        | Crear `[staging.deploy]` block; requiere VPC config                                                                                                        |
| `migrations-dry-run` CI job                                   | P1        | Sprint 2 #1 — validar SQL antes de deploy                                                                                                                  |
| `workflow_run` smoke test post-deploy                         | P2        | Sprint 2 #4                                                                                                                                                |
| Self-healing stack reconcile                                  | P2        | Sprint 2 #2                                                                                                                                                |
| Auto-migrate post-deploy                                      | P3        | Sprint 2 #3 (post-condition of #1)                                                                                                                         |
| Bootstrap del primer admin                                    | **P1**    | Desde la 005 `register` crea `student`, asi que un entorno nuevo nace SIN ningun admin y los endpoints admin son inalcanzables. Ver § 4.4.                 |
| Bootstrap seed migration                                      | P3        | Si se quiere sembrar admin sin API call                                                                                                                    |
| Custom Lambda Permission `SourceArn` check                    | P3        | Sprint 2 #5                                                                                                                                                |
| Aurora CA bundle in `node-runtime` layer                      | P2        | `build.sh` debe copiar `rds-ca-bundle.pem` al path `/var/task/certificates/rds.pem` esperado por `NODE_EXTRA_CA_CERTS`                                     |
| IAM `SecretsManagerReadWrite` `Resource: '*'` (5 occ.)        | P2        | Sprint 5 — scope a ARNs especficos                                                                                                                         |
| CORS `AllowOrigins: '*'` en prod                              | ~~P2~~    | ✅ Cerrado en PR-#87 (Sprint 3). El parametro CF `CorsAllowedOrigins` es configurable (default `*`); el handler echoa `Origin` cuando est en el allowlist. |
| JWT TTL drift (jwt-helpers default 3600 vs composition 86400) | P3        | Alinear defaults                                                                                                                                           |
| `audit_log` UPDATE/DELETE permission                          | P2        | compliance: `REVOKE UPDATE, DELETE ON identity.audit_log FROM <app_role>`                                                                                  |
| `audit_log` retention policy                                  | P2        | Partition por mes + archive a S3 (crecimiento indefinido)                                                                                                  |

---

## 9. On-call checklist (15 min triage)

1. **Hay alarma CloudWatch?** Qu mtrica dispar? (ver § 7.3)
2. **ltimo deploy:** `git log --since='24 hours ago' main --oneline`.
3. **Logs del handler afectado:** `aws logs tail <log-group> --since 15m`.
4. **X-Ray:** ver trace ms reciente con `http.status >= 500`.
5. **DB:** `aws rds describe-db-instances ... DBInstanceStatus`. Picos de
   `DBLoad`?
6. **EventBridge:** `aws events describe-event-bus
--name spark-match-events-dev`. Bus existe?
7. **Secrets Manager:** `aws secretsmanager describe-secret --secret-id
spark-match/jwt/dev`. Hay error de `DecryptionFailure`?
8. **Si todo OK pero 5xx persiste:** puede ser issue de cdigo. Rollback
   a la ltima versin estable (`sam deploy --config-env prod` con SHA
   anterior, ver § 2.3).
9. **Si es DB:** verificar Performance Insights para queries lentas. Si
   el cluster est overload, scale ACUs (Terraform).
10. **Si es secreto:** rotar (ver § 5).

---

## 10. Referencias

- [runtime-topology.md](./runtime-topology.md) — env vars, ARNs, layer names.
- [auth-rbac.md](./auth-rbac.md) — JWT lifecycle, secret rotation.
- [error-catalog.md](./error-catalog.md) — diagnstico por error code.
- [observability.md](./observability.md) — logging/tracing/metrics setup.
- `samconfig.toml` — deploy profiles.
- `template.yaml` + `contexts/identity/template.yaml` — IaC.
- `migrations/V00N__*.sql` — SQL source of truth.
