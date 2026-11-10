/**
 * Deferred loading for command and engine entry points.
 *
 * A command group that imports its handlers statically makes every command
 * load them. `onUse` gives the group a function with the handler's own
 * signature that imports the handler the first time it is called, so the build
 * can place the handlers in their own chunk and a process loads only what it
 * runs.
 */

/**
 * Wrap an asynchronous function so its module is imported on the first call.
 *
 * @param load - Imports the implementation and returns the function to call.
 * @returns A function with the same parameters and result as the implementation.
 */
export function onUse<Args extends unknown[], Result>(
  load: () => Promise<(...args: Args) => Promise<Result>>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => (await load())(...args);
}
