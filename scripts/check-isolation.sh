#!/usr/bin/env bash
# Verificacion de aislamiento del area privada y del DNS de jlc-ingenieros.com (requisito n.o 1).
# Uso: scripts/check-isolation.sh --snapshot | --compare
#   --snapshot  consulta por DoH todos los registros protegidos (todo salvo el A/AAAA del apex),
#               comprueba el area privada y, si todo esta bien, guarda la foto ordenada en
#               scripts/dns/baseline.txt.
#   --compare   repite las consultas, las compara con la foto (diff) y comprueba el area privada:
#               areaprivada, demo y met -> 3.12.236.157, https://areaprivada.jlc-ingenieros.com/ -> 200
#               y https://areaprivada.jlc-ingenieros.com/api/gesnorm -> sin 5xx ni error de conexion.
# Imprime "OK|FAIL <comprobacion>" por linea y un resumen final.
# Sale con 0 si todo esta bien, 1 si hay diferencias o falla algo, 2 si el uso es incorrecto.
# Solo lectura: no modifica ningun registro ni ningun servidor. Necesita bash y curl.
# Cada consulta y cada peticion HTTP se reintenta ISOLATION_RETRIES veces (defecto 3) esperando
# ISOLATION_DELAY segundos (defecto 2), para no confundir un fallo de red pasajero con un cambio.
# Variables (para pruebas): ISOLATION_DOH, ISOLATION_BASELINE, ISOLATION_HOME_URL, ISOLATION_API_URL.
# Las funciones de consulta y comprobacion se invocan de forma indirecta a traves de retry.
# shellcheck disable=SC2329
set -u
export LC_ALL=C

DOMAIN='jlc-ingenieros.com.'
PRIVATE_IP='3.12.236.157'
DOH=${ISOLATION_DOH:-https://dns.google/resolve}
BASELINE=${ISOLATION_BASELINE:-$(dirname "$0")/dns/baseline.txt}
HOME_URL=${ISOLATION_HOME_URL:-https://areaprivada.jlc-ingenieros.com/}
API_URL=${ISOLATION_API_URL:-https://areaprivada.jlc-ingenieros.com/api/gesnorm}
RETRIES=${ISOLATION_RETRIES:-3}
DELAY=${ISOLATION_DELAY:-2}

# Registros protegidos: "<nombre relativo (@ = apex)> <tipo>".
QUERIES='@ MX
@ NS
@ TXT
_dmarc TXT
www CNAME
6wmkdnrfnxi3midc2doz4m5wc77qz7g3._domainkey TXT
h3glg2fy22z7qzzye6g6zhg3tcuingqn._domainkey TXT
vdd56aijvyidt5xoo5g2lbdy73d7m2uh._domainkey TXT
firebase1._domainkey TXT
firebase2._domainkey TXT
sig1._domainkey TXT
areaprivada A
areaprivada TXT
demo A
met A'
PRIVATE_HOSTS='areaprivada demo met'

usage() {
  echo "uso: $0 --snapshot | --compare" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
MODE=$1
case "$MODE" in --snapshot | --compare) ;; *) usage ;; esac
if [ "$MODE" = "--compare" ] && [ ! -f "$BASELINE" ]; then
  echo "error: no existe la foto $BASELINE; ejecutar antes $0 --snapshot" >&2
  exit 2
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILED=0
report() { # report <0|1> <comprobacion>
  if [ "$1" -eq 0 ]; then echo "OK $2"; else echo "FAIL $2"; FAILED=1; fi
}

type_name() {
  case "$1" in
    1) echo A ;; 2) echo NS ;; 5) echo CNAME ;; 6) echo SOA ;; 15) echo MX ;; 16) echo TXT ;; 28) echo AAAA ;;
    *) echo "TYPE$1" ;;
  esac
}

# Un objeto de la seccion Answer de la API JSON de DoH (dns.google). El valor "data" puede llevar
# comillas y barras escapadas.
OBJ='\{"name":"[^"]*","type":[0-9]+,"TTL":[0-9]+,"data":"([^"\\]|\\.)*"\}'

# query <fqdn> <tipo>: imprime "<nombre> <tipo> <valor>" por registro de ese nombre (sin TTL, que
# varia en las caches, y sin los registros encadenados de otras zonas). Devuelve 1 si la consulta falla.
query() {
  qname=$1 qtype=$2
  json=$(curl -fsS --max-time 15 -G -H 'accept: application/dns-json' \
    --data-urlencode "name=$qname" --data-urlencode "type=$qtype" "$DOH" 2>/dev/null) || return 1
  status=$(printf '%s' "$json" | grep -oE '"Status": *[0-9]+' | head -n 1 | grep -oE '[0-9]+$')
  # Sin respuesta valida o SERVFAIL (2): error transitorio, no se guarda.
  { [ -n "$status" ] && [ "$status" != 2 ]; } || return 1
  if [ "$status" != 0 ]; then
    echo "$qname $qtype (status $status)"
    return 0
  fi
  case "$json" in
    *'"Answer":['*) ;;
    *) echo "$qname $qtype (sin registros)"; return 0 ;;
  esac
  rest=${json#*\"Answer\":\[}
  found=0
  while IFS= read -r obj; do
    [ -n "$obj" ] || continue
    name=$(printf '%s' "$obj" | sed -E 's/^\{"name":"([^"]*)".*/\1/' | tr '[:upper:]' '[:lower:]')
    [ "$name" = "$qname" ] || continue
    type=$(printf '%s' "$obj" | sed -E 's/^\{"name":"[^"]*","type":([0-9]+).*/\1/')
    data=$(printf '%s' "$obj" | sed -E -e 's/^.*,"data":"(.*)"\}$/\1/' -e 's/\\(["\\])/\1/g')
    echo "$name $(type_name "$type") $data"
    found=1
  done <<EOF
$(printf '%s' "$rest" | grep -oE "^($OBJ,?)*" | grep -oE "$OBJ")
EOF
  [ "$found" -eq 1 ] || echo "$qname $qtype (sin registros)"
}
query_to() { # query_to <fichero> <fqdn> <tipo>
  out=$1
  shift
  query "$@" >"$out"
}

# retry <comando...>: ejecuta hasta que devuelva 0, como mucho RETRIES veces.
retry() {
  n=1
  while :; do
    "$@" && return 0
    [ "$n" -ge "$RETRIES" ] && return 1
    n=$((n + 1))
    sleep "$DELAY"
  done
}

# 1. Foto actual del DNS.
: >"$TMP/current"
while read -r rel qtype; do
  if [ "$rel" = "@" ]; then fqdn=$DOMAIN; else fqdn="$rel.$DOMAIN"; fi
  if retry query_to "$TMP/q" "$fqdn" "$qtype"; then
    cat "$TMP/q" >>"$TMP/current"
    [ "$qtype" = A ] && cp "$TMP/q" "$TMP/a-${rel}"
  else
    report 1 "consulta DNS $fqdn $qtype (DoH $DOH)"
  fi
done <<EOF
$QUERIES
EOF
sort -u "$TMP/current" -o "$TMP/current"
[ "$FAILED" -eq 0 ] && report 0 "consultas DNS ($(wc -l <"$TMP/current" | tr -d ' ') registros)"

# 2. Comparacion con la foto anterior.
if [ "$MODE" = "--compare" ]; then
  if diff -u "$BASELINE" "$TMP/current" >"$TMP/diff"; then
    report 0 "DNS identico a la foto $BASELINE"
  else
    report 1 "DNS distinto de la foto $BASELINE (- foto, + ahora):"
    sed -n '3,$p' "$TMP/diff" | grep -E '^[-+]' | sed 's/^/    /'
  fi
fi

# 3. Area privada: DNS y HTTP.
for h in $PRIVATE_HOSTS; do
  got=$(cat "$TMP/a-$h" 2>/dev/null)
  rc=0
  [ "$got" = "$h.$DOMAIN A $PRIVATE_IP" ] || rc=1
  report $rc "$h.$DOMAIN A = $PRIVATE_IP${got:+ (ahora: $(echo "$got" | cut -d' ' -f2- | tr '\n' ' ' | sed 's/ $//'))}"
done

http_code() {
  c=$(curl -sS -o /dev/null --max-time 20 -w '%{http_code}' "$1" 2>/dev/null) || c=000
  echo "$c" >"$TMP/code"
}
home_ok() { http_code "$HOME_URL" && [ "$(cat "$TMP/code")" = 200 ]; }
api_ok() {
  http_code "$API_URL"
  case "$(cat "$TMP/code")" in 000 | 5*) return 1 ;; *) return 0 ;; esac
}
retry home_ok
report $? "area privada: GET $HOME_URL -> 200 (ahora: $(cat "$TMP/code"))"
retry api_ok
report $? "API del area privada: GET $API_URL -> sin 5xx ni error de conexion (ahora: $(cat "$TMP/code"))"

# 4. Resultado.
if [ "$FAILED" -ne 0 ]; then
  [ "$MODE" = "--snapshot" ] && echo "No se ha guardado la foto."
  echo "RESULTADO: FAIL. Detener el paso en curso y deshacerlo (docs/runbook-corte.md)."
  exit 1
fi
if [ "$MODE" = "--snapshot" ]; then
  mkdir -p "$(dirname "$BASELINE")"
  cp "$TMP/current" "$BASELINE"
  echo "Foto guardada en $BASELINE."
fi
echo "RESULTADO: OK. El area privada y los registros protegidos estan intactos."
exit 0
