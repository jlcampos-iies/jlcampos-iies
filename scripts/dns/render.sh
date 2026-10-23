#!/usr/bin/env bash
# Genera los UNICOS lotes de cambios de Route 53 permitidos en el corte de jlc-ingenieros.com.
# Uso: scripts/dns/render.sh <cutover|rollback|rollback-a|ttl60|ttl300> [dominio-cloudfront]
#   cutover  <dxxxx.cloudfront.net>  UPSERT A ALIAS + CREATE AAAA ALIAS del apex hacia CloudFront.
#   rollback <dxxxx.cloudfront.net>  UPSERT A 3.133.180.219 (TTL 60) + DELETE AAAA ALIAS del apex.
#   rollback-a                       Emergencia: solo UPSERT A 3.133.180.219 (TTL 60); no toca el AAAA.
#   ttl60 | ttl300                   UPSERT A 3.133.180.219 con ese TTL (solo mientras el apex
#                                    apunta a WordPress; tras el corte el A es un ALIAS sin TTL).
#   El dominio se acepta con o sin punto final; en el lote siempre va con punto final, que es
#   como lo guarda Route 53 (el DELETE del AAAA tiene que coincidir exactamente).
# Imprime el JSON para `aws route53 change-resource-record-sets --change-batch file://...`.
# Requisito n.o 1: todos los cambios son sobre Name "jlc-ingenieros.com." y Type A/AAAA; nada mas.
# Sale con 2 (sin imprimir nada) si el uso es incorrecto.
set -eu

APEX='jlc-ingenieros.com.'
WORDPRESS_IP='3.133.180.219'
CLOUDFRONT_ZONE='Z2FDTNDATAQYW2' # zona fija de los alias a CloudFront (valor de AWS)

usage() {
  echo "uso: $0 <cutover|rollback> <dxxxx.cloudfront.net> | $0 <rollback-a|ttl60|ttl300>" >&2
  exit 2
}

MODE=${1:-}
DOMAIN=${2:-}

needs_domain() {
  [ "$#" -eq 2 ] || usage
  DOMAIN=${DOMAIN%.}
  if ! [[ $DOMAIN =~ ^d[a-z0-9]+\.cloudfront\.net$ ]]; then
    echo "error: '$DOMAIN' no es un dominio de CloudFront (dxxxx.cloudfront.net)" >&2
    exit 2
  fi
}

alias_target() {
  printf '{ "HostedZoneId": "%s", "DNSName": "%s", "EvaluateTargetHealth": false }' "$CLOUDFRONT_ZONE" "$DOMAIN."
}

change_alias() { # change_alias <accion> <tipo>
  printf '    { "Action": "%s", "ResourceRecordSet": { "Name": "%s", "Type": "%s", "AliasTarget": %s } }' \
    "$1" "$APEX" "$2" "$(alias_target)"
}

change_wordpress() { # change_wordpress <ttl>
  printf '    { "Action": "UPSERT", "ResourceRecordSet": { "Name": "%s", "Type": "A", "TTL": %s, "ResourceRecords": [ { "Value": "%s" } ] } }' \
    "$APEX" "$1" "$WORDPRESS_IP"
}

batch() { # batch <comentario> <cambio>...
  comment=$1
  shift
  printf '{\n  "Comment": "%s",\n  "Changes": [\n' "$comment"
  first=1
  for c in "$@"; do
    [ "$first" -eq 1 ] || printf ',\n'
    printf '%s' "$c"
    first=0
  done
  printf '\n  ]\n}\n'
}

case "$MODE" in
  cutover)
    needs_domain "$@"
    batch "Corte: apex jlc-ingenieros.com A/AAAA ALIAS a $DOMAIN" \
      "$(change_alias UPSERT A)" "$(change_alias CREATE AAAA)"
    ;;
  rollback)
    needs_domain "$@"
    batch "Vuelta atras: apex jlc-ingenieros.com A a WordPress $WORDPRESS_IP (TTL 60) y sin AAAA" \
      "$(change_wordpress 60)" "$(change_alias DELETE AAAA)"
    ;;
  rollback-a)
    [ "$#" -eq 1 ] || usage
    batch "Vuelta atras de emergencia: solo el A del apex jlc-ingenieros.com a WordPress $WORDPRESS_IP (TTL 60)" \
      "$(change_wordpress 60)"
    ;;
  ttl60 | ttl300)
    [ "$#" -eq 1 ] || usage
    ttl=${MODE#ttl}
    batch "TTL $ttl del A del apex jlc-ingenieros.com (WordPress $WORDPRESS_IP)" "$(change_wordpress "$ttl")"
    ;;
  *)
    usage
    ;;
esac
