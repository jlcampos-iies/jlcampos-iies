// Genera infra/build/template.yaml a partir de infra/template.yaml:
//  - inserta el código de la CloudFront Function (edge/dist/viewer-request.js) en FunctionCode;
//  - reescribe CodeUri de la Lambda para que sea relativo a la plantilla generada
//    (sam deploy --template-file resuelve las rutas desde el directorio de la plantilla).
// Uso: node infra/render.mjs [salida]   (por defecto infra/build/template.yaml)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'infra/template.yaml');
const LAMBDA_DIR = join(root, 'lambda/contact');
const CODE_PLACEHOLDER = "FunctionCode: '__VIEWER_REQUEST_JS__'";
const CODE_URI = 'CodeUri: ../lambda/contact';

function replaceOnce(text, search, replacement) {
  const parts = text.split(search);
  if (parts.length !== 2) throw new Error(`infra/template.yaml debe contener exactamente una vez: ${search}`);
  return parts[0] + replacement + parts[1];
}

/** Pura: devuelve la plantilla con el código de la Function y el CodeUri indicados. */
export function render({ template, functionCode, codeUri }) {
  // Un literal JSON es un escalar YAML entre comillas dobles válido: conserva el código byte a byte.
  let out = replaceOnce(template, CODE_PLACEHOLDER, `FunctionCode: ${JSON.stringify(functionCode)}`);
  out = replaceOnce(out, CODE_URI, `CodeUri: ${codeUri}`);
  return out;
}

export function renderTo({ edgeFile = join(root, 'edge/dist/viewer-request.js'), outFile = join(root, 'infra/build/template.yaml') } = {}) {
  if (!existsSync(edgeFile)) {
    throw new Error(`falta ${edgeFile}; ejecuta antes \`npm run build\` (o \`npm run build:edge\` si dist/ ya existe).`);
  }
  const outDir = dirname(resolve(outFile));
  const codeUri = relative(outDir, LAMBDA_DIR).split(sep).join('/');
  const text = render({
    template: readFileSync(SOURCE, 'utf8'),
    functionCode: readFileSync(edgeFile, 'utf8'),
    codeUri,
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, text);
  return outFile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const out = renderTo(process.argv[2] ? { outFile: resolve(process.argv[2]) } : {});
    console.log(`${relative(process.cwd(), out)} generado.`);
  } catch (e) {
    console.error(`infra/render: ${e.message}`);
    process.exit(1);
  }
}
