import { findRanges } from '../FindBar';
import { findRegExp, matchOffsets } from '../findMatches';

const off = { matchCase: false, wholeWord: false, regex: false };
const find = (text: string, q: string, o = {}) => {
  const re = findRegExp(q, { ...off, ...o });
  return re ? matchOffsets(text, re).map(([a, b]) => text.slice(a, b)) : re;
};

it('plain text is literal and ignores case; options narrow it', () => {
  expect(find('a.b A.B axb', 'a.b')).toEqual(['a.b', 'A.B']);
  expect(find('a.b A.B', 'a.b', { matchCase: true })).toEqual(['a.b']);
  expect(find('user user1', 'user', { wholeWord: true })).toEqual(['user']);
  expect(find('a1 b22', '[0-9]+', { regex: true })).toEqual(['1', '22']);
});

it('bad, empty and zero-length expressions are safe', () => {
  expect(find('x', '(', { regex: true })).toBeUndefined();
  expect(find('x', '')).toBeNull();
  expect(find('abc', 'x*', { regex: true })).toEqual([]);
});

it('matches across elements of a line, not across lines', () => {
  const root = document.createElement('div');
  root.innerHTML = '<div data-find-line><b>"k"<i>:</i></b><span>"v"</span></div><div data-find-line>"z"</div>';
  const texts = (q: string) => findRanges(root, findRegExp(q, off)!).map((r) => r.toString());
  expect(texts('"k":"v"')).toEqual(['"k":"v"']);
  expect(texts('"v""z"')).toEqual([]);
  expect(texts('"')).toHaveLength(6);
});
