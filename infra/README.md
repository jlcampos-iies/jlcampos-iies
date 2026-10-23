# Infraestructura de jlc-ingenieros.com (despliegue manual)

Dos pilas de CloudFormation, que despliega el titular con sus credenciales:

| Pila | Región | Plantilla | Contenido |
|---|---|---|---|
| `jlc-web-publica-cert` | `us-east-1` | `infra/cert.yaml` | Certificado ACM de `jlc-ingenieros.com` + `www.jlc-ingenieros.com` |
| `jlc-web-publica` | `eu-west-3` | `infra/template.yaml` → `infra/build/template.yaml` | Bucket S3, CloudFront, CloudFront Function, Lambda `jlc-web-contact`, identidad SES (opcional), OIDC y rol de GitHub, presupuesto |

`infra/template.yaml` no se despliega tal cual: `node infra/render.mjs` genera `infra/build/template.yaml` con el código de la CloudFront Function (`edge/dist/viewer-request.js`) dentro. Si falta ese fichero, `render.mjs` falla y pide ejecutar antes el build.

**Requisitos:** AWS CLI v2, [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), Node.js 22, `openssl`, `gh` (para el paso 10) y credenciales con permisos de administración en la cuenta.

Las órdenes se ejecutan desde la raíz del repo.

## Pasos (en este orden)

### 1. Foto inicial del DNS y del área privada

```bash
scripts/check-isolation.sh --snapshot
```

Guarda el estado de todos los registros del dominio (salvo A/AAAA del apex) y comprueba que `areaprivada`, `demo` y `met` responden. Si algo falla aquí, **no seguir**.

### 2. Parámetros de SSM (París)

El secreto de Turnstile se crea ahora con un valor provisional y se sustituye por el real en el paso 9 (el widget necesita el dominio de CloudFront, que aún no existe). `read -rs` evita que el valor quede en el historial.

```bash
read -rs TURNSTILE_SECRET   # escribir "pendiente" (o el secreto real si el widget ya existe) y pulsar Intro
aws ssm put-parameter --region eu-west-3 \
  --name /jlc-web-publica/turnstile-secret --type SecureString \
  --value "$TURNSTILE_SECRET" --tags Key=project,Value=jlc-web-publica

aws ssm put-parameter --region eu-west-3 \
  --name /jlc-web-publica/origin-verify --type String \
  --value "$(openssl rand -hex 32)" --tags Key=project,Value=jlc-web-publica
```

### 3. ¿Existe ya la identidad SES del dominio en París?

```bash
aws sesv2 get-email-identity --email-identity jlc-ingenieros.com --region eu-west-3
```

- `NotFoundException` → `CreateSesIdentity=true` (la pila crea una identidad nueva en París, con 3 CNAME DKIM **nuevos**).
- Devuelve la identidad → `CreateSesIdentity=false` (se reutiliza sin modificarla).

### 4. ¿Existe ya el proveedor OIDC de GitHub?

```bash
aws iam list-open-id-connect-providers
```

Si aparece un ARN que termina en `oidc-provider/token.actions.githubusercontent.com`, comprobar su audiencia:

```bash
aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::<cuenta>:oidc-provider/token.actions.githubusercontent.com
```

- Si `ClientIDList` contiene `sts.amazonaws.com`: se pasa como `ExistingGitHubOidcProviderArn` y la pila lo reutiliza sin tocarlo.
- Si **no** lo contiene: el rol de despliegue no podrá asumirse con ese proveedor. Esta guía no lo modifica: es un recurso IAM existente y puede estar en uso. El titular decide si añadir la audiencia (`aws iam add-client-id-to-open-id-connect-provider --client-id sts.amazonaws.com …`, que solo añade un valor a la lista) después de revisar quién usa ese proveedor. No se puede crear un segundo proveedor con la misma URL en la misma cuenta.

Si no aparece ninguno, `ExistingGitHubOidcProviderArn` se deja vacío y la pila lo crea.

### 5. Certificado ACM (us-east-1)

```bash
aws cloudformation deploy --template-file infra/cert.yaml \
  --stack-name jlc-web-publica-cert --region us-east-1 \
  --tags project=jlc-web-publica
```

La orden se queda esperando hasta que el certificado esté validado. Mientras tanto, en la consola de **ACM (región us-east-1)** → el certificado → **"Crear registros en Route 53"**. Ese botón solo **añade** los CNAME de validación (nombres nuevos `_xxxx.jlc-ingenieros.com` y `_yyyy.www.jlc-ingenieros.com`); no modifica ningún registro existente. Cuando termine:

```bash
scripts/check-isolation.sh --compare
CERT_ARN=$(aws cloudformation describe-stacks --stack-name jlc-web-publica-cert --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='CertificateArn'].OutputValue" --output text)
echo "$CERT_ARN"
```

### 6. Pila principal (París)

**Antes de desplegar, comprobar la cuota de concurrencia de Lambda:**

```bash
aws lambda get-account-settings --region eu-west-3 --query AccountLimit.ConcurrentExecutions
```

AWS exige que, después de reservar, queden al menos 100 ejecuciones sin reservar en la cuenta (cuota − reservas ≥ 100). Con el valor normal (1000 o más) no hay nada que hacer. Si devuelve `10` (cuentas nuevas), hay dos opciones:

- desplegar con `ContactReservedConcurrency=0` (sin reserva; la propia cuota de 10 ya limita el gasto), o
- pedir el aumento en **Service Quotas → AWS Lambda → Concurrent executions** hasta el valor normal (1000) y desplegar cuando se haya aplicado.

**Partir siempre de `main` actualizado**, porque un `sam deploy` manual sube el código local de la Lambda y de la Function, y pisaría lo que haya publicado GitHub Actions:

```bash
git checkout main && git pull
```

El build local solo sirve para generar la CloudFront Function (necesita la lista de rutas de `dist/`); la web la publica después GitHub Actions. Por eso basta con la clave de pruebas de Turnstile.

```bash
npm ci && PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build && node infra/render.mjs && \
sam deploy --template-file infra/build/template.yaml --stack-name jlc-web-publica --region eu-west-3 \
  --capabilities CAPABILITY_IAM --resolve-s3 --confirm-changeset --tags project=jlc-web-publica \
  --parameter-overrides \
    CertificateArn="$CERT_ARN" \
    EnableAliases=false \
    CreateSesIdentity=true \
    TurnstileHostnames=jlc-ingenieros.com
```

- Cambiar `CreateSesIdentity=true` por `false` si en el paso 3 la identidad ya existía.
- Si en el paso 4 había proveedor OIDC, añadir `ExistingGitHubOidcProviderArn=arn:aws:iam::<cuenta>:oidc-provider/token.actions.githubusercontent.com`.
- Con concurrencia reservada no disponible (ver arriba), añadir `ContactReservedConcurrency=0`.
- `--confirm-changeset` muestra el conjunto de cambios antes de aplicarlo y pide confirmación. En el **primer** despliegue todo debe ser **Add**. En despliegues posteriores es normal ver **Modify** (y algún Add/Remove) sobre recursos de esta pila; nunca debe aparecer nada que no sea de la pila, ningún `AWS::Route53::*` ni `AWS::EC2::*`. Si aparece, responder `n`.
- Si el **primer** despliegue falla, la pila queda en `ROLLBACK_COMPLETE` y no se puede actualizar: hay que borrarla antes de reintentar (no contiene nada todavía):

  ```bash
  aws cloudformation delete-stack --stack-name jlc-web-publica --region eu-west-3
  aws cloudformation wait stack-delete-complete --stack-name jlc-web-publica --region eu-west-3
  ```

  El proveedor OIDC y la identidad SES tienen `DeletionPolicy: Retain`, así que pueden **sobrevivir** al borrado de la pila. Antes de reintentar, repetir los pasos 3 y 4: si la identidad SES ya existe, pasar `CreateSesIdentity=false`; si el proveedor OIDC ya existe, pasar su ARN en `ExistingGitHubOidcProviderArn`. Si no, el reintento falla porque el recurso ya existe.
- `--resolve-s3` crea (una sola vez) la pila `aws-sam-cli-managed-default` con un bucket para el paquete de la Lambda. Es independiente de todo lo demás.

Salidas de la pila (se usan en los pasos siguientes):

```bash
aws cloudformation describe-stacks --stack-name jlc-web-publica --region eu-west-3 \
  --query 'Stacks[0].Outputs' --output table
```

`BucketName`, `DistributionId`, `DistributionDomain`, `DeployRoleArn`, `ContactFunctionName`, `EdgeFunctionName`, `ContactFunctionUrl` y, si se creó la identidad SES, `DkimRecord{1,2,3}{Name,Value}`.

**Presupuesto:** el aviso de 5 USD solo cuenta los costes etiquetados `project=jlc-web-publica` (así el área privada no lo dispara). Para que funcione hay que activar una vez la etiqueta: consola de **Billing and Cost Management → Cost allocation tags → User-defined → `project` → Activate** (puede tardar hasta 24 h en aparecer después del despliegue).

### 7. DKIM de SES (solo si `CreateSesIdentity=true`)

Consola de **SES (región París, eu-west-3)** → Identities → `jlc-ingenieros.com` → **"Publicar registros en Route 53"**. El botón solo **añade** los 3 CNAME `<token>._domainkey.jlc-ingenieros.com` de las salidas `DkimRecord*` (tokens nuevos, distintos de los `*._domainkey` existentes, que no se tocan). Después:

```bash
scripts/check-isolation.sh --compare
```

### 8. Verificar el destinatario en SES

SES sigue en *sandbox* y solo entrega a direcciones verificadas.

```bash
aws sesv2 create-email-identity --email-identity jlcampos@jlc-ingenieros.com --region eu-west-3
```

Abrir el correo que envía AWS a `jlcampos@jlc-ingenieros.com` y pulsar el enlace de verificación. (Si ya figura como verificada, la orden devuelve `AlreadyExistsException` y no hay que hacer nada.)

### 9. Widget de Turnstile

En Cloudflare → Turnstile → *Add widget*, con los dominios `jlc-ingenieros.com` y `<DistributionDomain>` (salida del paso 6, `xxxx.cloudfront.net`). Guardar la clave de sitio (paso 10) y sustituir el secreto provisional:

```bash
read -rs TURNSTILE_SECRET   # pegar el secret key del widget
aws ssm put-parameter --region eu-west-3 --overwrite \
  --name /jlc-web-publica/turnstile-secret --type SecureString --value "$TURNSTILE_SECRET"
```

Para poder probar el formulario en `<DistributionDomain>` antes del corte, volver a ejecutar (desde `main` actualizado) el `sam deploy` del paso 6 con `TurnstileHostnames=jlc-ingenieros.com,<DistributionDomain>` (esto además reinicia la Lambda, que así lee el secreto nuevo). Después del corte se puede volver a dejar solo `jlc-ingenieros.com`.

### 10. Variables de GitHub

Son *variables* (no secretos): el repo es público y ninguno de estos valores es secreto.

```bash
R=jlcampos-iies/jlcampos-iies
gh variable set AWS_ROLE_ARN              --repo $R --body "<DeployRoleArn>"
gh variable set S3_BUCKET                 --repo $R --body "<BucketName>"
gh variable set CF_DISTRIBUTION_ID        --repo $R --body "<DistributionId>"
gh variable set CF_FUNCTION_NAME          --repo $R --body "<EdgeFunctionName>"
gh variable set CONTACT_FUNCTION_NAME     --repo $R --body "<ContactFunctionName>"
gh variable set SITE_URL                  --repo $R --body "https://<DistributionDomain>"
gh variable set PUBLIC_TURNSTILE_SITE_KEY --repo $R --body "<clave de sitio del paso 9>"
```

`SITE_URL` apunta a `https://<DistributionDomain>` hasta el corte, y a `https://jlc-ingenieros.com` después. El siguiente push a `main` publica la web en el bucket. El corte (`EnableAliases=true` y cambio del registro A del apex) está en `docs/runbook-corte.md`.

## Qué NO toca esta pila (requisito nº 1)

- **Route 53:** ninguna plantilla crea, modifica ni importa zonas o registros. `cert.yaml` valida por DNS **sin** `HostedZoneId`, y la identidad SES no publica DKIM por sí sola. Los únicos registros nuevos los añade el titular con los botones de ACM (paso 5) y SES (paso 7), que solo **añaden** nombres nuevos. `areaprivada`, `demo`, `met`, MX, los TXT del apex, `_dmarc`, los `*._domainkey` existentes, NS, SOA y `www` no se tocan nunca.
- **EC2 del área privada (`3.12.236.157`):** no hay ningún recurso EC2, VPC ni *security group*; nada se importa ni se referencia.
- **SES existente:** si ya hay identidad en París se reutiliza sin cambios (`CreateSesIdentity=false`); si no, se crea una nueva solo en París. El MAIL FROM no cambia, así que el SPF tampoco.
- **IAM:** solo se crean dos roles nuevos (Lambda y GitHub). El proveedor OIDC se reutiliza si ya existe.
- **HSTS** sin `includeSubDomains` ni `preload`: no impone HTTPS a ningún subdominio.

## Marcha atrás

Si los alias ya están activos, primero devolver el registro A del apex a su valor anterior (`docs/runbook-corte.md`). Después:

1. Vaciar el bucket (está versionado, así que hay que borrar también las versiones): consola de S3 → `jlc-web-publica-site-<cuenta>` → **Vaciar**. CloudFormation no puede borrar un bucket con contenido.
2. Borrar las pilas:

```bash
aws cloudformation delete-stack --stack-name jlc-web-publica --region eu-west-3
aws cloudformation wait stack-delete-complete --stack-name jlc-web-publica --region eu-west-3
aws cloudformation delete-stack --stack-name jlc-web-publica-cert --region us-east-1
```

Borrar las pilas **nunca toca Route 53**: los CNAME añadidos en los pasos 5 y 7 se quedan (son inocuos) y, si se quieren quitar, se borran a mano por su nombre exacto.

Tampoco se borran (a propósito):

- el proveedor OIDC y la identidad SES `jlc-ingenieros.com` de París, aunque los haya creado la pila (`DeletionPolicy: Retain`): otros repos podrían usar el proveedor y el DKIM publicado apunta a la identidad;
- los parámetros de SSM (`/jlc-web-publica/*`) y la identidad `jlcampos@jlc-ingenieros.com` del paso 8, que no son de la pila.

Si de verdad se quieren quitar, después de comprobar que nada más los usa (la identidad del dominio en París **solo** si la creó esta pila, es decir, si en el paso 3 dio `NotFoundException`):

```bash
aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::<cuenta>:oidc-provider/token.actions.githubusercontent.com
aws sesv2 delete-email-identity --email-identity jlc-ingenieros.com --region eu-west-3
aws sesv2 delete-email-identity --email-identity jlcampos@jlc-ingenieros.com --region eu-west-3
aws ssm delete-parameters --region eu-west-3 \
  --names /jlc-web-publica/turnstile-secret /jlc-web-publica/origin-verify
```

## Problemas conocidos

- **Error de `ReservedConcurrentExecutions` (`… decreases account's UnreservedConcurrentExecution below its minimum value …`):** la cuota de concurrencia de la cuenta no deja reservar. Ver la comprobación previa del paso 6: desplegar con `ContactReservedConcurrency=0` o pedir el aumento de la cuota (valor normal: 1000). Si era el primer despliegue, borrar antes la pila en `ROLLBACK_COMPLETE`.
- **Cambiar el secreto de origen** (`/jlc-web-publica/origin-verify`): cambiar solo el valor en SSM **no basta**. CloudFormation resuelve `{{resolve:ssm:…}}` al desplegar y, si la plantilla y los parámetros no cambian, no actualiza nada. Hace falta un cambio en la plantilla o en la pila que actualice la distribución y la Lambda. Mientras CloudFront propaga el valor nuevo (unos minutos), el formulario puede responder 403 un rato: hacerlo fuera de horas.
