const oneLine = (s) => s.replace(/[\r\n]+/g, ' ').trim();

export function buildEmail(data, now) {
  const subject = `[Web] Contacto de ${oneLine(data.name).slice(0, 100)}`;
  const text = [
    `Nombre: ${data.name}`,
    `Email: ${data.email}`,
    `Teléfono: ${data.phone || '-'}`,
    `Idioma: ${data.lang}`,
    `Fecha: ${now.toISOString()}`,
    '',
    'Mensaje:',
    data.message,
    '',
  ].join('\n');
  return { subject, text, replyTo: data.email };
}
