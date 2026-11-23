import { fieldLabelFor } from '../../actions/registry';
import { filterLabel } from '../filters';
import { jsonPathField } from '../jsonPaths';
import { escapeKqlIdent } from '../kql';
import { pathLabel } from '../pathLabel';

it.each(['a:b', 'http:', 'x:Int64', 'k8s:pod.na:me', 'a "q" b', 'back\\slash', 'a.:b', 'plain.path'])(
  'JSON path %j is shown by its own name, typed or not',
  (path) => {
    for (const types of [['String'], ['Array(Nullable(String))'], ['Int64', 'String'], undefined]) {
      expect(pathLabel(jsonPathField('P', path, undefined, types).sqlExpr)).toBe(`P.${path}`);
    }
  }
);

it('leaves other expressions alone', () => {
  for (const e of ['ServiceName', "M['m:k']", "M['a.\"b\"']"]) {
    expect(pathLabel(e)).toBe(e);
  }
  expect(fieldLabelFor("M['m:k']")).toBe('M.m:k');
});

it('filter pills and actions show the name, not the SQL', () => {
  const field = jsonPathField('P', 'a:b', undefined, ['String']).sqlExpr;
  expect(filterLabel({ id: '1', field, op: '=', value: 'x' })).toBe('P.a:b = x');
  expect(fieldLabelFor(field)).toBe('P.a:b');
});

it('a suggestion inserts a readable name', () => {
  expect(escapeKqlIdent('P.a:b')).toBe('P.a\\:b');
});
