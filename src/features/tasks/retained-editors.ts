"use client";
import { useCallback, useRef } from "react";

export type RetainedRow<T> = T & { unavailable?: boolean };
/** Remote deletion must not unmount a row that owns unsaved text. */
export function useRetainedEditors<T extends { id: string }>() {
  const editing = useRef(new Set<string>());
  const onEditingChange = useCallback((id: string, active: boolean) => {
    if (active) editing.current.add(id); else editing.current.delete(id);
  }, []);
  const retain = useCallback((previous: RetainedRow<T>[] | null, next: T[]) => {
    const ids = new Set(next.map(row => row.id));
    return [...next, ...(previous ?? []).filter(row => !ids.has(row.id) && editing.current.has(row.id))
      .map(row => ({ ...row, unavailable: true }))];
  }, []);
  return { onEditingChange, retain };
}
