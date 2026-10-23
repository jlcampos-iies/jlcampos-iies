// CloudFront Function (cloudfront-js-2.0), viewer-request.
// REDIRECTS y KNOWN los inyecta edge/build.mjs.
var REDIRECTS = /*REDIRECTS*/{};
var UPLOADS = /*UPLOADS*/{};
var KNOWN = /*KNOWN*/'';
var APEX = 'jlc-ingenieros.com';
var WP_PARAMS = { p: 1, page_id: 1 };

function qsPairs(querystring, skipWp) {
  var out = [];
  Object.keys(querystring || {}).forEach(function (name) {
    if (skipWp && WP_PARAMS[name] === 1) return;
    var q = querystring[name];
    var items = q.multiValue && q.multiValue.length ? q.multiValue : [q];
    items.forEach(function (it) {
      out.push(name + '=' + (it.value === undefined ? '' : it.value));
    });
  });
  return out;
}

function qsString(querystring, skipWp) {
  var pairs = qsPairs(querystring, skipWp);
  return pairs.length ? '?' + pairs.join('&') : '';
}

function redirect(location) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: location },
      'cache-control': { value: 'public, max-age=3600' }
    }
  };
}

function notFound() {
  return {
    statusCode: 404,
    statusDescription: 'Not Found',
    headers: {
      'cache-control': { value: 'public, max-age=300' },
      'content-type': { value: 'text/plain; charset=utf-8' }
    },
    body: { encoding: 'text', data: 'Not Found' }
  };
}

function isProbe(lower) {
  return (
    lower.indexOf('/wp-admin') === 0 ||
    lower.indexOf('/wp-json') === 0 ||
    lower.indexOf('/wp-includes') === 0 ||
    lower === '/wp-login.php' ||
    lower === '/xmlrpc.php' ||
    lower.slice(-4) === '.php'
  );
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var host = request.headers && request.headers.host ? request.headers.host.value.toLowerCase() : APEX;
  var qs = request.querystring || {};

  // 1. www -> apex
  if (host === 'www.' + APEX) {
    return redirect('https://' + APEX + uri + qsString(qs, false));
  }

  // 2. sondas de WordPress
  if (isProbe(uri.toLowerCase())) return notFound();

  // 3. parametros WP (?p=, ?page_id=)
  if (qs.p !== undefined || qs.page_id !== undefined) {
    return redirect(uri + qsString(qs, true));
  }

  // 4. mapa de redirecciones (con y sin barra final)
  var UP = '/wp-content/uploads/';
  if (uri.indexOf(UP) === 0) {
    var cut = uri.lastIndexOf('/');
    var d = uri.slice(UP.length, cut);
    var file = uri.slice(cut + 1);
    // hasOwnProperty en los dos niveles: /constructor/, /__proto__/... no son entradas del mapa.
    var dir = Object.prototype.hasOwnProperty.call(UPLOADS, d) ? UPLOADS[d] : null;
    if (dir && Object.prototype.hasOwnProperty.call(dir, file)) {
      return redirect('/img/' + (dir[file] === 1 ? file : dir[file]) + qsString(qs, false));
    }
  }
  var key = Object.prototype.hasOwnProperty.call(REDIRECTS, uri)
    ? uri
    : uri.slice(-1) !== '/' && Object.prototype.hasOwnProperty.call(REDIRECTS, uri + '/')
      ? uri + '/'
      : null;
  if (key !== null) return redirect(REDIRECTS[key] + qsString(qs, false));

  // Ficheros (extension en el ultimo segmento) y /api: sin cambios
  var last = uri.slice(uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') !== -1 || uri.indexOf('/api/') === 0) return request;

  // 5-6. minusculas y barra final (un solo salto, solo hacia rutas conocidas)
  var lower = uri.toLowerCase();
  var withSlash = lower.slice(-1) === '/' ? lower : lower + '/';
  if (KNOWN.indexOf(' ' + withSlash + ' ') !== -1 && withSlash !== uri) {
    return redirect(withSlash + qsString(qs, false));
  }

  // 7. indice para el origen S3
  if (uri.slice(-1) === '/') request.uri = uri + 'index.html';
  return request;
}
