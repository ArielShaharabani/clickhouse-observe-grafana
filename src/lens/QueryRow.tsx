/**
 * Visualize's query row (R3-QUERYBAR): the same Add filter / query menu / KQL search bar Discover
 * composes (pages/LogsExplorer.tsx), over the shared search context in the URL. Typing changes
 * nothing until the bar submits (Enter / Search); an unparseable query is reported through
 * `onInvalidQuery` and never reaches `onSearch`.
 */
import React from 'react';
import { QueryBar, QueryBarProps } from '../components/QueryBar';

/** The URL params after a submitted query: `q` set (or dropped when blank); the same object when nothing changed. */
export function withQuery(prev: URLSearchParams, next: string): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (next.trim()) {
    sp.set('q', next);
  } else {
    sp.delete('q');
  }
  return sp.toString() === prev.toString() ? prev : sp;
}

type Props = Omit<QueryBarProps, 'children' | 'data-testid'>;

export function QueryRow(p: Props) {
  return <QueryBar {...p} data-testid="lens-query-row" />;
}
