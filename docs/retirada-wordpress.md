# Retirada del WordPress (instancia Lightsail `3.133.180.219`)

Pasos 12–14 del plan de corte (spec §10). Solo se empieza cuando la web estática lleva funcionando en `jlc-ingenieros.com` desde el corte (`docs/runbook-corte.md`) sin incidencias.

> **Atención: el área privada es OTRA máquina.** `areaprivada`, `demo` y `met` están en una **EC2** (`3.12.236.157`), no en Lightsail. Nada de esta lista se hace sobre esa EC2, sus volúmenes, su IP elástica ni sus *security groups*. Antes de cada acción, comprobar que la instancia es la de IP **`3.133.180.219`**. Esta retirada no toca el DNS.

## 0. Antes de empezar

- [ ] `scripts/check-isolation.sh --compare` → `RESULTADO: OK`.
- [ ] El DNS del apex apunta a CloudFront (no a `3.133.180.219`):

  ```bash
  ZONA=$(aws route53 list-hosted-zones-by-name --dns-name jlc-ingenieros.com --query 'HostedZones[0].Id' --output text)
  aws route53 list-resource-record-sets --hosted-zone-id "${ZONA##*/}" \
    --query "ResourceRecordSets[?Name=='jlc-ingenieros.com.' && Type=='A']"
  #   debe mostrar AliasTarget …cloudfront.net
  ```

- [ ] Identificar la instancia y su región (debe salir la IP `3.133.180.219`):

  ```bash
  aws lightsail get-instances --region <región> \
    --query 'instances[].[name,publicIpAddress,location.regionName]' --output table
  aws lightsail get-static-ips --region <región> \
    --query 'staticIps[].[name,ipAddress,attachedTo]' --output table
  ```

## 1. Paso 12: la instancia no aloja nada más

Conectarse (`ssh <usuario>@3.133.180.219`) y revisar:

- [ ] *Vhosts* de Apache: `sudo apachectl -S` — solo debe aparecer `jlc-ingenieros.com` (y `www`). Si la instancia es Bitnami, `sudo /opt/bitnami/apache/bin/apachectl -S`.
- [ ] Sitios activos: `ls /etc/apache2/sites-enabled` (en Bitnami, `ls /opt/bitnami/apache/conf/vhosts`) — ningún otro dominio.
- [ ] *Crontab* de todos los usuarios:

  ```bash
  for u in $(cut -d: -f1 /etc/passwd); do echo "== $u"; sudo crontab -l -u "$u" 2>/dev/null; done
  ls /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly
  ```

  Ninguna tarea que no sea de WordPress (copias, envíos de correo, sincronizaciones con otros sistemas).
- [ ] Servicios en escucha: `sudo ss -tlnp` — solo SSH, Apache/nginx, MySQL/MariaDB local y PHP-FPM. Cualquier otro puerto abierto se investiga antes de seguir.
- [ ] Otros dominios o aplicaciones: `ls /var/www /opt/bitnami 2>/dev/null` y `sudo grep -rhoE 'Server(Name|Alias) +[^ ]+' /etc/apache2 /opt/bitnami/apache/conf 2>/dev/null | sort -u`.
- [ ] Que no haya nada que llame a esta IP desde fuera (por ejemplo, `areaprivada` o un formulario antiguo que envíe a WordPress): en los registros de Apache de los últimos días (`sudo tail -n 200 /var/log/apache2/access.log` o `/opt/bitnami/apache/logs/access_log`) solo deben quedar bots y escáneres.

## 2. Copia de seguridad

- [ ] Snapshot de Lightsail (si el del paso 6 del runbook tiene más de unos días, hacer otro ahora):

  ```bash
  aws lightsail create-instance-snapshot --region <región> \
    --instance-name <instancia> --instance-snapshot-name wordpress-retirada-$(date +%Y%m%d)
  aws lightsail get-instance-snapshots --region <región> \
    --query 'instanceSnapshots[].[name,state,createdAt]' --output table   # esperar a "available"
  ```

- [ ] Copias locales de `wp-content/uploads` y de la exportación WXR (paso 6 del runbook) guardadas fuera de la instancia.

## 3. Paso 13: detener (2–4 semanas después del corte)

- [ ] `scripts/check-isolation.sh --compare` → `RESULTADO: OK`.
- [ ] `aws lightsail stop-instance --region <región> --instance-name <instancia>`
- [ ] `scripts/check-isolation.sh --compare` → `RESULTADO: OK` y `scripts/smoke.sh https://jlc-ingenieros.com --host-check` sin `FAIL`.
- [ ] Apuntar la fecha: a partir de aquí ya no se puede hacer la vuelta atrás del runbook sin volver a arrancar la instancia (`aws lightsail start-instance …`; la IP estática se mantiene mientras no se libere).

## 4. Paso 14: eliminar (30 días después de detenerla, sin incidencias)

- [ ] `scripts/check-isolation.sh --compare` → `RESULTADO: OK`.
- [ ] Confirmar que existe el snapshot en estado `available` (apartado 2).
- [ ] Eliminar la instancia: `aws lightsail delete-instance --region <región> --instance-name <instancia>`.
- [ ] **Liberar la IP estática de Lightsail** (una IP estática sin asociar se cobra): `aws lightsail release-static-ip --region <región> --static-ip-name <nombre-de-la-ip>`. Es la IP estática **de Lightsail** con `ipAddress` `3.133.180.219` (salida de `get-static-ips`); **no** es la IP elástica de la EC2 del área privada (`3.12.236.157`), que no se toca.
- [ ] `scripts/check-isolation.sh --compare` → `RESULTADO: OK`.
- [ ] Conservar el snapshot **6 meses** (apuntar la fecha de borrado) o, si sale más barato, exportarlo a EC2/EBS (`aws lightsail export-snapshot …`) y borrar el de Lightsail. Pasados los 6 meses: `aws lightsail delete-instance-snapshot --region <región> --instance-snapshot-name <snapshot>`.

## 5. Licencias

- [ ] No renovar **Rank Math PRO**.
- [ ] No renovar **WP Rocket**.
- [ ] No renovar **Salient** (tema de ThemeForest/Envato).

Desactivar la renovación automática en cada proveedor y quitar la licencia del sitio si el panel lo permite.

## 6. Limpieza del repositorio (tras eliminar la instancia)

- [ ] Borrar el script de migración desde WordPress, que ya no podrá ejecutarse: `scripts/migrate/extract.mjs` (y la carpeta `scripts/migrate/` si queda vacía). Quitar también las dependencias que solo usaba él (`turndown`, `@types/turndown`) si ningún otro fichero las importa, y ejecutar `npm test` antes de hacer commit.

> Datos de la instancia (inventario del 23-10-2026): región `us-east-2`, instancia `JLC_Ingenieros_WordPress` (plan `micro_3_0`), IP estática `IPjlc` (`3.133.180.219`).
