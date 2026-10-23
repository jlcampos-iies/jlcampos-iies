#!/usr/bin/env bash
# Comprobaciones de humo de la web publicada.
# Uso: scripts/smoke.sh <url-base> [--host-check]
#   --host-check  comprueba ademas el 301 de www a apex (solo tras el corte de dominio).
# Imprime "OK|FAIL <comprobacion>" por linea; sale con 0 si todo pasa, 1 si algo falla, 2 si el uso es incorrecto.
# Cada comprobacion se reintenta SMOKE_RETRIES veces (defecto 5) esperando SMOKE_DELAY segundos
# (defecto 10), porque la invalidacion de CloudFront tarda en propagarse.
# Cada peticion se corta a los SMOKE_MAX_TIME segundos (defecto 20; conexion: 10) para no colgarse.
# Las funciones attempt se invocan de forma indirecta a través de retry.
# shellcheck disable=SC2329
set -u

BASE=${1:-}
if [ -z "$BASE" ]; then
  echo "uso: $0 <url-base> [--host-check]" >&2
  exit 2
fi
BASE=${BASE%/}
HOST_CHECK=0
[ "${2:-}" = "--host-check" ] && HOST_CHECK=1

RETRIES=${SMOKE_RETRIES:-5}
DELAY=${SMOKE_DELAY:-10}
CURL_LIMITS=(--connect-timeout 10 --max-time "${SMOKE_MAX_TIME:-20}")
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

FAILED=0
report() { # report <0|1> <comprobacion>
  if [ "$1" -eq 0 ]; then echo "OK $2"; else echo "FAIL $2"; FAILED=1; fi
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

# Deja en $TMP/code y $TMP/loc el estado y la ruta de destino (sin esquema ni host) de una peticion GET.
fetch() { # fetch <url>
  curl "${CURL_LIMITS[@]}" -sS -o /dev/null -w '%{http_code} %{redirect_url}' "$1" 2>/dev/null >"$TMP/out" || return 1
  read -r code loc <"$TMP/out"
  echo "$code" >"$TMP/code"
  echo "${loc:-}" >"$TMP/loc"
}

check_status() { # check_status <ruta> <estado> [<destino>]
  path=$1 want=$2 dest=${3:-}
  attempt() {
    fetch "$BASE$path" || return 1
    [ "$(cat "$TMP/code")" = "$want" ] || return 1
    [ -z "$dest" ] && return 0
    [ "$(sed -E 's#^[a-z]+://[^/]+##' "$TMP/loc")" = "$dest" ]
  }
  retry attempt
  rc=$?
  report $rc "GET $path -> $want${dest:+ $dest}"
}

check_header() { # check_header <ruta> <cabecera>
  path=$1 name=$2
  attempt() {
    curl "${CURL_LIMITS[@]}" -sS -D "$TMP/headers" -o /dev/null "$BASE$path" 2>/dev/null || return 1
    grep -qi "^$name:" "$TMP/headers"
  }
  retry attempt
  rc=$?
  report $rc "header $name en $path"
}

check_contact() {
  attempt() {
    code=$(curl "${CURL_LIMITS[@]}" -sS -o "$TMP/body" -w '%{http_code}' -X POST \
      -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' \
      --data '' "$BASE/api/contact" 2>/dev/null) || return 1
    [ "$code" = "400" ] && grep -qF '"error":"validation"' "$TMP/body"
  }
  retry attempt
  rc=$?
  report $rc "POST /api/contact -> 400 validation"
}

check_host() {
  attempt() {
    fetch "https://www.jlc-ingenieros.com/estudio/" || return 1
    [ "$(cat "$TMP/code")" = "301" ] && [ "$(cat "$TMP/loc")" = "https://jlc-ingenieros.com/estudio/" ]
  }
  retry attempt
  rc=$?
  report $rc "GET https://www.jlc-ingenieros.com/estudio/ -> 301 https://jlc-ingenieros.com/estudio/"
}

for p in / /en/ /ca/ /estudio/ \
  /proyectos/apartamentos-turisticos/ \
  /proyectos/fabrica-de-hielo/ \
  /proyectos/instalacion-de-captacion-de-energia-solar-termica-en-edificio-de-viviendas/ \
  /proyectos/instalacion-solar-fotovoltaica-en-modalidad-de-autoconsumo/ \
  /proyectos/instalacion-solar-fotovoltaica/ \
  /proyectos/nave-industrial/; do
  check_status "$p" 200
done

check_status /en/home/ 301 /en/
check_status /ca/inici/ 301 /ca/
check_status /feed/ 301 /
check_status /wp-login.php 404

for h in strict-transport-security content-security-policy x-content-type-options; do
  check_header / "$h"
done

check_contact
[ "$HOST_CHECK" -eq 1 ] && check_host

exit "$FAILED"
