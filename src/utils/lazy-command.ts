/**
 * Defers loading a command's implementation until the command runs.
 *
 * The CLI registers every command at startup, but runs one. Importing each
 * implementation up front made `llmwiki --help` load the whole product,
 * including every provider SDK. A lazy command has the implementation's
 * signature and imports its module on first call, so a process loads only the
 * command it was asked to run.
 */

/** `implementation`'s parameters, resolving to its (awaited) result. */
type Lazy<F extends (...args: never[]) => unknown> = (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>;

/**
 * Give a function its implementation's signature and import the implementation
 * on first call. `load` must contain a literal `import()` so the bundler emits a
 * separate chunk. A synchronous implementation becomes asynchronous: its callers
 * must await it.
 */
export function lazyCommand<F extends (...args: never[]) => unknown>(load: () => Promise<F>): Lazy<F> {
  const deferred = async (...args: Parameters<F>): Promise<unknown> => (await load())(...args);
  return deferred as Lazy<F>;
}
