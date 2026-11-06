// Stable English phrases; consumers translate by code if needed.
export const MESSAGES = Object.freeze({
  content_error: 'Page content could not be decoded.',
  unclosed_string: 'A content string is not closed.',
  unclosed_hex: 'A hexadecimal content string is not closed.',
  invalid_token: 'An unexpected content delimiter was found.',
  invalid_stream: 'A content stream is invalid.',
  cyclic_form: 'Form content is cyclic or exceeds the nesting limit.',
  invalid_resources: 'A resource dictionary is invalid.',
  byte_budget: 'The content byte inspection budget was exceeded.',
  operation_budget: 'The content operation inspection budget was exceeded.',
  inline_image: 'An inline image requires confirmation.',
  unsupported_operator: 'A content operator requires confirmation.',
  missing_font: 'A painted text font could not be resolved.',
  pattern: 'A pattern or shading requires confirmation.',
  missing_xobject: 'A painted XObject could not be resolved.',
  unsupported_xobject: 'An XObject requires confirmation.',
  empty: 'The file is empty.',
  not_pdf: 'The file does not have a PDF header.',
  encrypted: 'The PDF is encrypted. Provide an unencrypted copy.',
  parse_error: 'The PDF could not be opened.',
  no_pages: 'The PDF has no pages.',
  scan: 'Only image content was found.',
  outlined: 'Paths were found without text or images; notation may be outlined.',
  mixed: 'Image and vector or text evidence is mixed.',
  unknown: 'The PDF kind could not be confirmed.',
  incomplete: 'Some page content could not be inspected completely.',
  vector: 'Painted registered music fonts were found on every page.',
  source_conflict: 'Source evidence is ambiguous or conflicting.',
  snapshot_disabled: 'The bundled data does not enable this software or font.',
  unconfirmed: 'The bundled data cannot confirm compatibility.',
  try_tutti: 'Worth trying Tutti. This is a routing suggestion; confirm compatibility on the website.',
});
export const reason = code => ({code, text: MESSAGES[code]});

export function inspectionError(code) {
  const error = new Error(MESSAGES[code]);
  error.inspectionCode = code;
  return error;
}
