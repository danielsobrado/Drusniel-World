export async function load(url, context, next) {
  return url.endsWith('.css')
    ? { format: 'module', source: '', shortCircuit: true }
    : next(url, context);
}
