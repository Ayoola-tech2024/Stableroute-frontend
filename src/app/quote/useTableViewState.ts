'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEBOUNCE_MS,
  DEFAULT_VIEW_STATE,
  parseViewState,
  serializeViewState,
  type TableViewState,
} from './tableModel';

/**
 * Owns the quotes-table view state with the URL as source of truth.
 *
 * - On mount the query string is parsed once and restored (inside an effect,
 *   never during render, so server HTML and the first client render agree and
 *   hydration stays clean).
 * - Every committed change is written back via `history.replaceState`, which
 *   updates the address bar without adding history entries or re-rendering
 *   the Next.js app shell.
 * - The text filter input is kept as local state for instant feedback and
 *   committed to the URL/state after `DEBOUNCE_MS` of inactivity; committing
 *   a filter or sort change resets the page to 1.
 *
 * Using `history.replaceState` directly (instead of Next's router) keeps this
 * hook dependency-free, avoids the Suspense requirement of
 * `useSearchParams`, and works identically under static export.
 */
export function useTableViewState() {
  const [view, setView] = useState<TableViewState>(DEFAULT_VIEW_STATE);
  const [filterInput, setFilterInput] = useState('');
  const viewRef = useRef(view);
  viewRef.current = view;

  // Restore from the URL exactly once after mount.
  useEffect(() => {
    const restored = parseViewState(
      new URLSearchParams(window.location.search)
    );
    setView(restored);
    setFilterInput(restored.filter);
  }, []);

  const commit = useCallback((patch: Partial<TableViewState>) => {
    setView((prev) => {
      const next = { ...prev, ...patch };
      const params = serializeViewState(next);
      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}`
      );
      return next;
    });
  }, []);

  /** Debounced commit of the filter input; resets to page 1. */
  useEffect(() => {
    const timer = setTimeout(() => {
      if (filterInput !== viewRef.current.filter) {
        commit({ filter: filterInput, page: 1 });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filterInput, commit]);

  const update = useCallback(
    (patch: Partial<TableViewState>) => {
      commit({ ...patch, page: patch.page ?? 1 });
    },
    [commit]
  );

  return { view, update, filterInput, setFilterInput };
}
