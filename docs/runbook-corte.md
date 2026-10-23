# Runbook del corte de jlc-ingenieros.com (WordPress → S3 + CloudFront)

Lo ejecuta el titular, a mano, con sus credenciales de AWS. Sigue los pasos 1–14 de la spec (§10) y se apoya en `infra/README.md` para el despliegue de las pilas. Las órdenes se ejecutan desde la raíz del repo, en `main` actualizado (`git checkout main && git pull`).

> **Qué NO se toca nunca (requisito nº 1)**
>
> El único registro DNS que se **cambia** es el **A de `jlc-ingenieros.com.`** y el único que se **añade/quita** en el apex es su **AAAA**. Los lotes salen siempre de `scripts/dns/render.sh`, que no puede generar otra cosa. Nunca se tocan:
>
> - `areaprivada.jlc-ingenieros.com` (A `3.12.236.157` y TXT), `demo.jlc-ingenieros.com` (A) y `met.jlc-ingenieros.com` (A).
> - `www.jlc-ingenieros.com` (CNAME → `jlc-ingenieros.com`): **no necesita ningún cambio**, sigue al apex por sí solo.
> - Los MX del apex (`mx01.mail.icloud.com`, `mx02.mail.icloud.com`).
> - Todos los TXT del apex: `apple-domain=…`, `firebase=gesnormauth`, el de verificación y el SPF (`v=spf1 include:icloud.com include:_spf.firebasemail.com ~all`).
> - `_dmarc.jlc-ingenieros.com` (`p=none`).
> - Los `*._domainkey` existentes: `6wmkdnrfnxi3midc2doz4m5wc77qz7g3`, `h3glg2fy22z7qzzye6g6zhg3tcuingqn`, `vdd56aijvyidt5xoo5g2lbdy73d7m2uh` (SES), `firebase1`, `firebase2` (Firebase) y `sig1` (iCloud).
> - NS y SOA de la zona.
> - La EC2 del área privada (`3.12.236.157`), su nginx, sus *security groups* y su API `/api/gesnorm`. La instancia Lightsail de WordPress (`3.133.180.219`) es **otra máquina**.
>
> Los únicos registros nuevos (nombres que no existían) los añaden los botones de ACM y SES del paso 3.

## Regla de oro

Antes y después de **cada** paso que toque el DNS:

```bash
scripts/check-isolation.sh --compare
```

Tiene que terminar en `RESULTADO: OK` (código de salida 0). Si da `FAIL` **antes**, no se hace el paso. Si da `FAIL` **después**, el paso se detiene y se deshace (vuelta atrás, al final) antes de seguir investigando. El script compara todos los registros protegidos con la foto `scripts/dns/baseline.txt` (no mira el A/AAAA del apex, que es lo único que cambia) y comprueba que `areaprivada`, `demo` y `met` resuelven a `3.12.236.157`, que `https://areaprivada.jlc-ingenieros.com/` da 200 y que `/api/gesnorm` no da 5xx ni error de conexión.

## Variables que se usan en todo el runbook

Estas variables solo existen en la terminal donde se definen: **volver a ejecutar este bloque en cada terminal nueva** (también si se abre otra para la vuelta atrás). Sin ellas, `render.sh` falla por falta de dominio y `aws route53` por falta de zona.

```bash
# Zona de Route 53 (solo lectura)
ZONA=$(aws route53 list-hosted-zones-by-name --dns-name jlc-ingenieros.com --query 'HostedZones[0].Id' --output text)
ZONA=${ZONA##*/}
aws route53 get-hosted-zone --id "$ZONA" --query 'HostedZone.[Name,Config.PrivateZone]' --output text
#   debe imprimir: jlc-ingenieros.com.  False   (si no, NO seguir)

# Dominio de la distribución (salida DistributionDomain de la pila, dxxxx.cloudfront.net)
DIST_DOMAIN=$(aws cloudformation describe-stacks --stack-name jlc-web-publica --region eu-west-3 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" --output text)
echo "$DIST_DOMAIN"

# Estado actual del A/AAAA del apex (solo lectura; útil antes de cada lote)
aws route53 list-resource-record-sets --hosted-zone-id "$ZONA" \
  --query "ResourceRecordSets[?Name=='jlc-ingenieros.com.' && (Type=='A' || Type=='AAAA')]"
```

Cómo se aplica **cualquier** lote (los pasos 7, 9, la vuelta atrás y el TTL final):

```bash
scripts/dns/render.sh <modo> [dominio] > /tmp/jlc-lote.json   # 1. generar
cat /tmp/jlc-lote.json                                         # 2. revisar: solo "jlc-ingenieros.com." y A/AAAA
CAMBIO=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONA" \
  --change-batch file:///tmp/jlc-lote.json --query 'ChangeInfo.Id' --output text)   # 3. aplicar
aws route53 wait resource-record-sets-changed --id "$CAMBIO"   # 4. esperar a INSYNC (≈ 1 min)
```

Route 53 aplica el lote entero o nada: si una de sus operaciones falla (por ejemplo, el `CREATE` del AAAA porque ya existe), no se cambia ningún registro.

## Preparación (sin impacto en la web actual)

### 1. Foto de referencia

```bash
scripts/check-isolation.sh --snapshot
```

Debe terminar en `RESULTADO: OK` y reescribir `scripts/dns/baseline.txt`. Si `git diff scripts/dns/baseline.txt` muestra cambios respecto a la foto del repo, revisarlos antes de seguir (alguien ha cambiado el DNS desde entonces).

### 2. Despliegue de las pilas

Pasos 2–10 de `infra/README.md` (SSM, SES, OIDC, certificado, pila principal con `EnableAliases=false`, DKIM, destinatario SES, Turnstile y variables de GitHub). Al terminar, la web está publicada en `https://$DIST_DOMAIN` y el dominio sigue apuntando a WordPress.

### 3. CNAME de ACM y de DKIM

**Ya hecho en el paso 2** (botones de ACM y SES, pasos 5 y 7 de `infra/README.md`); no se repite. Solo confirmar que esos botones no tocaron nada protegido:

```bash
scripts/check-isolation.sh --compare   # RESULTADO: OK
```

### 4. Turnstile y destinatario de SES

**Ya hecho en el paso 2** (pasos 8 y 9 de `infra/README.md`: destinatario verificado en SES, widget con `jlc-ingenieros.com` y `$DIST_DOMAIN`, secreto en SSM y `sam deploy` con `TurnstileHostnames=jlc-ingenieros.com,<DistributionDomain>`); no se repite. Confirmar de nuevo:

```bash
scripts/check-isolation.sh --compare   # RESULTADO: OK
```

### 5. Revisión en la URL de pruebas

```bash
scripts/smoke.sh "https://$DIST_DOMAIN"
```

Debe salir sin ningún `FAIL`. Además, a mano en `https://<DistributionDomain>/`:

- revisión visual en móvil y escritorio (las tres lenguas, los 6 proyectos, publicaciones, clientes y textos legales);
- Lighthouse (Chrome → DevTools → Lighthouse) en la home y en una ficha de proyecto: objetivo ≥ 95 en rendimiento, accesibilidad, buenas prácticas y SEO;
- un **envío real** del formulario en **cada idioma** (`/contacto/`, `/en/contact/` y `/ca/contacte/`), comprobando que llegan los tres correos a `jlcampos@jlc-ingenieros.com` con acentos legibles y que «Responder» va al remitente (en `/ca/contacte/` el widget de Turnstile sale en castellano: Cloudflare no admite catalán);
- una vez, que las redirecciones conservan la *query string* codificada:

  ```bash
  curl -sI "https://$DIST_DOMAIN/en/home/?a=b%20c" | grep -i '^location'
  #   location: /en/?a=b%20c
  ```

### 6. Copia de seguridad de WordPress

Instancia Lightsail con IP `3.133.180.219` (no confundir con la EC2 del área privada, `3.12.236.157`):

```bash
aws lightsail get-instances --region <región> \
  --query 'instances[].[name,publicIpAddress,location.regionName]' --output table
aws lightsail create-instance-snapshot --region <región> \
  --instance-name <instancia> --instance-snapshot-name wordpress-antes-del-corte-$(date +%Y%m%d)
aws lightsail get-instance-snapshots --region <región> \
  --query 'instanceSnapshots[].[name,state]' --output table   # esperar a "available"
```

(`<región>`: la de la instancia en la consola de Lightsail.) Además:

- **Uploads:** `ssh <usuario>@3.133.180.219 'sudo tar czf - -C <ruta-de-wordpress> wp-content/uploads' > wp-uploads.tar.gz` (la ruta se ve con `sudo find / -maxdepth 5 -type d -path "*wp-content/uploads" 2>/dev/null`).
- **Exportación WXR:** escritorio de WordPress → Herramientas → Exportar → *Todo el contenido* → descargar el `.xml`.

Guardar ambos ficheros fuera de la instancia.

### 7. TTL del A del apex a 60 s (24 h antes del corte)

`www` es un CNAME al apex y no necesita cambios. Comprobar antes que el A del apex sigue siendo `3.133.180.219` (no un ALIAS) con la consulta de estado de arriba.

```bash
scripts/check-isolation.sh --compare
scripts/dns/render.sh ttl60 > /tmp/jlc-lote.json && cat /tmp/jlc-lote.json
CAMBIO=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONA" \
  --change-batch file:///tmp/jlc-lote.json --query 'ChangeInfo.Id' --output text)
aws route53 wait resource-record-sets-changed --id "$CAMBIO"
scripts/check-isolation.sh --compare
```

Esperar **24 h** antes del paso 8 (así ningún resolvedor guarda el TTL antiguo de 300 s).

## Corte (unos 5 min, en una franja de poco tráfico)

### 8. Alias y certificado en la distribución

Mismo `sam deploy` del paso 6 de `infra/README.md`, desde `main` actualizado, con **los mismos valores** de `CreateSesIdentity`, `ExistingGitHubOidcProviderArn` y `ContactReservedConcurrency` que en el primer despliegue, y cambiando solo `EnableAliases=true` y `TurnstileHostnames=jlc-ingenieros.com` (el dominio `cloudfront.net` de pruebas ya no hace falta una vez verificado en el paso 5):

```bash
scripts/check-isolation.sh --compare
CERT_ARN=$(aws cloudformation describe-stacks --stack-name jlc-web-publica-cert --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='CertificateArn'].OutputValue" --output text)
git checkout main && git pull
npm ci && PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build && node infra/render.mjs && \
sam deploy --template-file infra/build/template.yaml --stack-name jlc-web-publica --region eu-west-3 \
  --capabilities CAPABILITY_IAM --resolve-s3 --confirm-changeset --tags project=jlc-web-publica \
  --parameter-overrides \
    CertificateArn="$CERT_ARN" \
    EnableAliases=true \
    CreateSesIdentity=<igual que en el paso 6> \
    TurnstileHostnames=jlc-ingenieros.com
#   (+ ExistingGitHubOidcProviderArn=… y/o ContactReservedConcurrency=0 si se usaron en el paso 6)
scripts/check-isolation.sh --compare
```

En el conjunto de cambios solo debe aparecer **Modify** sobre la distribución y la Lambda de contacto; ningún `AWS::Route53::*` ni `AWS::EC2::*`. Si aparece otra cosa, responder `n`. Asignar los alias **no cambia el DNS**: el dominio sigue en WordPress.

Comprobar que la distribución ya sirve el dominio con el certificado, sin tocar el DNS (`--connect-to` manda la petición a CloudFront):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' --connect-to "jlc-ingenieros.com:443:$DIST_DOMAIN:443" https://jlc-ingenieros.com/
#   200
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' --connect-to "www.jlc-ingenieros.com:443:$DIST_DOMAIN:443" https://www.jlc-ingenieros.com/estudio/
#   301 https://jlc-ingenieros.com/estudio/
```

Si cualquiera de las dos falla (error de certificado, 403…), **no seguir** al paso 9.

### 9. Cambio del A del apex (un único lote)

`UPSERT` del A del apex (de `3.133.180.219` a ALIAS → CloudFront) y `CREATE` del AAAA ALIAS → CloudFront. `www` no cambia.

```bash
scripts/check-isolation.sh --compare
scripts/dns/render.sh cutover "$DIST_DOMAIN" > /tmp/jlc-lote.json && cat /tmp/jlc-lote.json
CAMBIO=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONA" \
  --change-batch file:///tmp/jlc-lote.json --query 'ChangeInfo.Id' --output text)
aws route53 wait resource-record-sets-changed --id "$CAMBIO"
scripts/check-isolation.sh --compare
```

### 10. Comprobaciones después del corte

```bash
scripts/check-isolation.sh --compare
SMOKE_RETRIES=12 scripts/smoke.sh https://jlc-ingenieros.com --host-check
```

`smoke.sh` comprueba la home en los 3 idiomas, los 6 proyectos, los 301 de `/en/home/`, `/ca/inici/`, `/feed/` y `www`, el 404 de `/wp-login.php`, el formulario y las cabeceras de seguridad. Debe salir sin ningún `FAIL` (los reintentos cubren el minuto que tardan las cachés de DNS). Hacer también un envío real del formulario en `https://jlc-ingenieros.com/contacto/`.

Si algo falla y no se resuelve en unos minutos: **vuelta atrás** (abajo).

Si todo va bien, apuntar GitHub al dominio definitivo (lo usa la prueba de humo del despliegue):

```bash
gh variable set SITE_URL --repo jlcampos-iies/jlcampos-iies --body "https://jlc-ingenieros.com"
```

Opcional: en Cloudflare → Turnstile → el widget, quitar el dominio `cloudfront.net` de pruebas.

### 11. Search Console y TTL

En [Google Search Console](https://search.google.com/search-console), propiedad `jlc-ingenieros.com` (la de dominio o la de prefijo `https://jlc-ingenieros.com/`, la que ya exista):

1. **Sitemaps** → enviar `https://jlc-ingenieros.com/sitemap.xml` (y retirar sitemaps antiguos de WordPress/Rank Math, como `sitemap_index.xml`, si figuran).
2. **Inspección de URLs** → inspeccionar y «Solicitar indexación» de las principales: `https://jlc-ingenieros.com/`, `/en/`, `/ca/`, `/estudio/`, `/proyectos/`, `/contacto/`.
3. Revisar **Páginas** y **Rastreo** los días siguientes: las URLs antiguas deben aparecer como «Página con redirección», no como errores 404/5xx.

**TTL:** tras el corte, el A y el AAAA del apex son ALIAS a CloudFront y **no tienen TTL propio** (Route 53 usa el de CloudFront), así que no hay nada que restaurar. **No** ejecutar `render.sh ttl300` con el apex en CloudFront: ese lote vuelve a poner el A en `3.133.180.219` (WordPress) y desharía el corte. `ttl300` solo se usa si el apex apunta a WordPress: corte aplazado después del paso 7, o 48 h después de una vuelta atrás sin incidencias:

```bash
scripts/check-isolation.sh --compare
aws route53 list-resource-record-sets --hosted-zone-id "$ZONA" \
  --query "ResourceRecordSets[?Name=='jlc-ingenieros.com.' && Type=='A']"
#   debe mostrar ResourceRecords 3.133.180.219 (NO AliasTarget); si muestra AliasTarget, NO seguir
scripts/dns/render.sh ttl300 > /tmp/jlc-lote.json && cat /tmp/jlc-lote.json
CAMBIO=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONA" \
  --change-batch file:///tmp/jlc-lote.json --query 'ChangeInfo.Id' --output text)
aws route53 wait resource-record-sets-changed --id "$CAMBIO"
scripts/check-isolation.sh --compare
```

## Vuelta atrás

Un único lote: `UPSERT` del A del apex a `3.133.180.219` (TTL 60) y `DELETE` del AAAA ALIAS. Efecto en ≈ 1 min. WordPress sigue encendido hasta el paso 13.

```bash
scripts/check-isolation.sh --compare      # si da FAIL, seguir igualmente con la vuelta atrás y avisar
scripts/dns/render.sh rollback "$DIST_DOMAIN" > /tmp/jlc-lote.json && cat /tmp/jlc-lote.json
CAMBIO=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONA" \
  --change-batch file:///tmp/jlc-lote.json --query 'ChangeInfo.Id' --output text)
aws route53 wait resource-record-sets-changed --id "$CAMBIO"
scripts/check-isolation.sh --compare
curl -sS -o /dev/null -w '%{http_code}\n' https://jlc-ingenieros.com/   # 200, servido de nuevo por WordPress
```

- `rollback` necesita el mismo `$DIST_DOMAIN` que el corte (si la terminal es nueva, ejecutar antes el bloque de **Variables**): el `DELETE` del AAAA tiene que coincidir exactamente con el registro creado, y Route 53 aplica el lote entero o nada.
- Los alias de la distribución (`EnableAliases=true`) pueden quedarse: sin DNS que apunte a CloudFront no tienen efecto.
- Si se vuelve atrás después de cambiar `SITE_URL`, devolverla a `https://<DistributionDomain>`.

**Si la vuelta atrás falla (cualquier error en el `change-resource-record-sets` o en el `wait`)**, no reintentar a ciegas. Consultar el estado real del apex (solo lectura):

```bash
aws route53 list-resource-record-sets --hosted-zone-id "$ZONA" \
  --query "ResourceRecordSets[?Name=='jlc-ingenieros.com.']"
```

- Si el **A** ya muestra `ResourceRecords` `3.133.180.219` (no `AliasTarget`) y no hay AAAA: la web ya está en WordPress; no hay nada más que deshacer (pasa, por ejemplo, si el lote del corte nunca llegó a aplicarse).
- Si el **A** todavía muestra `AliasTarget`: devolver **solo el A** a WordPress con el lote de emergencia `rollback-a`, que no toca el AAAA y por eso no puede fallar por él:

  ```bash
  scripts/dns/render.sh rollback-a > /tmp/jlc-lote.json && cat /tmp/jlc-lote.json
  CAMBIO=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONA" \
    --change-batch file:///tmp/jlc-lote.json --query 'ChangeInfo.Id' --output text)
  aws route53 wait resource-record-sets-changed --id "$CAMBIO"
  scripts/check-isolation.sh --compare
  ```

- Si queda un **AAAA** con `AliasTarget` (haya hecho falta `rollback-a` o no) (los clientes IPv6 seguirían yendo a CloudFront): copiar su `DNSName` **exacto** de la salida de la consulta anterior (con el punto final) y borrarlo aparte con `rollback`, pasándole ese valor:

  ```bash
  aws route53 list-resource-record-sets --hosted-zone-id "$ZONA" \
    --query "ResourceRecordSets[?Name=='jlc-ingenieros.com.' && Type=='AAAA'].AliasTarget.DNSName" --output text
  #   dxxxx.cloudfront.net.
  ```

  `rollback <ese dominio>` vuelve a escribir el A (ya en `3.133.180.219`, sin efecto) y borra el AAAA; aplicarlo con los cuatro pasos de siempre y terminar con `scripts/check-isolation.sh --compare`.

## Retirada de WordPress

Con la lista de comprobación de `docs/retirada-wordpress.md`:

12. Comprobar en la instancia Lightsail (`3.133.180.219`) que no aloja nada más (*vhosts* de Apache, *crontab*, servicios en escucha, otros dominios).
13. A las 2–4 semanas del corte sin incidencias: **detener** la instancia Lightsail.
14. A los 30 días de detenerla sin incidencias: eliminar la instancia, **liberar la IP estática de Lightsail** y conservar el snapshot 6 meses. No renovar las licencias de Rank Math PRO, WP Rocket ni Salient.

Ninguno de estos pasos toca el DNS ni la EC2 del área privada, pero se ejecuta igualmente `scripts/check-isolation.sh --compare` antes y después de cada uno.
