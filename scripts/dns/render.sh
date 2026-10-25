#!/usr/bin/env bash
# Genera los UNICOS lotes de cambios de Route 53 permitidos en el corte de jlc-ingenieros.com.
# Uso: scripts/dns/render.sh cutover <dxxxx.cloudfront.net>
#   cutover  <dxxxx.cloudfront.net>  UPSERT A ALIAS + CREATE AAAA ALIAS del apex hacia CloudFront.
#   Los modos rollback, rollback-a, ttl60 y ttl300 (A del apex a WordPress 3.133.180.219) se
#   retiraron el 25-10-2026: WordPress se eliminó y su IP estática se liberó, así que apuntar
#   el dominio a esa IP lo entregaría a quien la reciba después. Ahora se rechazan.
#   El dominio se acepta con o sin punto final; en el lote siempre va con punto final, que es
#   como lo guarda Route 53 (el DELETE del AAAA tiene que coincidir exactamente).
# Imprime el JSON para `aws route53 change-resource-record-sets --change-batch file://...`.
# Requisito n.o 1: todos los cambios son sobre Name "jlc-ingenieros.com." y Type A/AAAA; nada mas.
# Sale con 2 (sin imprimir nada) si el uso es incorrecto.
set -eu

APEX='jlc-ingenieros.com.'
CLOUDFRONT_ZONE='Z2FDTNDATAQYW2' # zona fija de los alias a CloudFront (valor de AWS)

usage() {
  echo "uso: $0 cutover <dxxxx.cloudfront.net>" >&2
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
  rollback | rollback-a | ttl60 | ttl300)
    echo "error: '$MODE' ya no existe: WordPress se retiró el 25-10-2026 y su IP 3.133.180.219 se liberó" >&2
    exit 2
    ;;
  *)
    usage
    ;;
esac
