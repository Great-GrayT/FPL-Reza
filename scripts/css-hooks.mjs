/**
 * CSS modules, stubbed for the test runner.
 *
 * A component that imports its own stylesheet cannot be rendered under `tsx`
 * without this: node refuses the `.css` extension outright, so every render
 * test would be a test of the module loader rather than of the component. The
 * stub returns the class name for whatever is asked of it, which keeps
 * `styles.table` a usable string in the markup and asserts nothing about the
 * styling itself.
 */
export function load(url, context, next) {
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default new Proxy({}, { get: (_, key) => String(key) });',
    };
  }
  return next(url, context);
}
