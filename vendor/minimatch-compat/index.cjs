// ESLint plugins still require the callable CommonJS API from minimatch 3.
// Keep that interface while delegating all matching to patched upstream code.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- legacy consumers require a synchronous CommonJS export
const patched = require('minimatch-patched');
function callable(api) {
  const implementation = typeof api === 'function' ? api : api.minimatch;
  const match = (path, pattern, options) => implementation(path, pattern, options);
  Object.assign(match, api);
  // The legacy import plugin only calls .test(); do not compile untrusted
  // globs back to regular expressions. This is deliberately not a RegExp API.
  match.makeRe = (pattern, options) => ({ test: path => match(path, pattern, options) });
  match.defaults = options => callable(api.defaults(options));
  return match;
}
module.exports = callable(patched);
