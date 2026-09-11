type HistoryGuard = (event: PopStateEvent) => void;
type Registry = { installed: boolean; guards: Set<HistoryGuard> };

function registry(): Registry {
  const client = window as Window & { orbitHistoryGuard?: Registry };
  return client.orbitHistoryGuard ??= { installed: false, guards: new Set() };
}

/** Install before hydration, hence before App Router's Window popstate listener.
 * Capture alone does not reorder listeners on the Window event target. */
export function installHistoryGuard() {
  const state = registry();
  if (state.installed) return;
  state.installed = true;
  window.addEventListener("popstate", event => {
    for (const guard of state.guards) guard(event);
  }, true);
}

export function registerHistoryGuard(guard: HistoryGuard): () => void {
  installHistoryGuard();
  const state = registry();
  state.guards.add(guard);
  return () => { state.guards.delete(guard); };
}
