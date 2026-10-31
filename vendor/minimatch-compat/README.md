# Temporary lint dependency compatibility

Existing ESLint plugins use the callable minimatch 3 CommonJS export. The
patched minimatch 11.0.3 exports named functions and removed regex generation.
This adapter delegates matching to the patched upstream package while retaining
the callable interface. For eslint-plugin-import's `makeRe(...).test(...)` usage,
it returns a predicate object, not a RegExp. It is not a general-purpose drop-in
replacement for consumers inspecting regex source or flags.

The TypeScript parser receives minimatch 11.0.3 directly. Remove this adapter when
the lint plugins support the current upstream interface. Tests exercise legacy
calls, the actual import lint rule, and bounded globparts preprocessing from
GHSA-g3hv-75wg-m249. No advisory is suppressed and the security audit stays enabled.
