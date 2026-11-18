"""Coordinator helper: fold docs/dev/pending/<SPEC>.md into the project docs and bump the version.

Usage (from the feature worktree root):
  python scripts/dev/fold-pending.py <SPEC-ID> <PLAN-row-#> <PR-#> <new-version> "<Feature title>" "<key files>"

Does: CHANGELOG release section, DECISIONS entry (next D number, newest first), TESTING section
(TESTING + Acceptance tables), PLAN row -> done, CONTEXT "Built so far" row, PROGRESS last step,
package.json / package-lock.json / src/plugin.json version, deletes the pending file.
"""
import datetime
import json
import re
import sys
from pathlib import Path


def read(p):
    return Path(p).read_text(encoding='utf-8')


def write(p, s):
    Path(p).write_text(s, encoding='utf-8', newline='\n')


def sections(text):
    """Split a pending file into {heading: body} by '## ' headings; '' holds the preamble."""
    out, cur = {'': []}, ''
    for line in text.splitlines():
        m = re.match(r'^## (.+)$', line)
        if m:
            cur = m.group(1).strip()
            out[cur] = []
        else:
            out[cur].append(line)
    return {k: '\n'.join(v).strip() for k, v in out.items()}


def table_body(md):
    rows = [l for l in md.splitlines() if l.startswith('|')]
    return rows[2:] if len(rows) >= 2 else []


def main():
    spec, row, pr, version, title, files = sys.argv[1:7]
    today = datetime.date.today().isoformat()
    pending = Path(f'docs/dev/pending/{spec}.md')
    sec = sections(read(pending))
    get = lambda name: next((v for k, v in sec.items() if k.lower().startswith(name.lower())), '')

    # CHANGELOG
    cl = read('CHANGELOG.md')
    marker = '## [Unreleased]\n\n---\n'
    assert marker in cl, 'CHANGELOG Unreleased marker not found'
    cl = cl.replace(marker, f'{marker}\n## [{version}] — {today}\n\n{get("CHANGELOG")}\n\n---\n', 1)
    write('CHANGELOG.md', cl)

    # DECISIONS: next D number, inserted before the current newest
    dec = read('docs/dev/DECISIONS.md')
    nums = [int(n) for n in re.findall(r'^## D(\d+) ', dec, re.M)]
    top = max(nums)
    known = {'', 'changelog', 'decision', 'testing', 'acceptance'}
    extra = [f'{k}: {v}' for k, v in sec.items() if k.lower() not in known and v]
    body = get('Decision') + ('\n\n' + '\n\n'.join(extra) if extra else '')
    entry = f'## D{top + 1} — {title} ({spec})\n{body}\n\n'
    dec = re.sub(rf'^## D{top} ', lambda m: entry + m.group(0), dec, count=1, flags=re.M)
    write('docs/dev/DECISIONS.md', dec)

    # TESTING
    t = read('docs/dev/TESTING.md').rstrip('\n')
    t += f'\n\n### {spec} (PR {pr})\n| Case | Status |\n| --- | --- |\n' + '\n'.join(table_body(get('TESTING')))
    acc = table_body(get('Acceptance'))
    if acc:
        t += f'\n\n{spec} acceptance:\n\n| Criterion | Test / status |\n| --- | --- |\n' + '\n'.join(acc)
    write('docs/dev/TESTING.md', t + '\n')

    # PLAN
    plan = read('docs/dev/PLAN.md')
    plan, n = re.subn(rf'^(\| {row} \| [^\n]*?\| )in-progress \| [^|\n]*\|$', rf'\1done | PR {pr} |', plan, flags=re.M)
    assert n == 1, f'PLAN row {row} not found as in-progress'
    write('docs/dev/PLAN.md', plan)

    # CONTEXT "Built so far": append after the table's last row
    ctx = read('docs/dev/CONTEXT.md')
    m = re.search(r'## Built so far\n(?:[^\n]*\n)*?(\|[^\n]*\n)(?!\|)', ctx)
    if m:
        ctx = ctx[:m.end(1)] + f'| {row} | {spec}: {title} | {pr} | {files} |\n' + ctx[m.end(1):]
    ctx = re.sub(r'^Last saved: .*$', f'Last saved: {today}, #{row} {spec} merged (PR {pr}, v{version}).', ctx, count=1, flags=re.M)
    write('docs/dev/CONTEXT.md', ctx)

    # PROGRESS
    prog = read('docs/dev/PROGRESS.md')
    prog = re.sub(r'^\*\*Last completed step:\*\*.*$',
                  f'**Last completed step:** #{row} {spec} ({title}) in PR {pr} (v{version}).', prog, count=1, flags=re.M)
    write('docs/dev/PROGRESS.md', prog)

    # versions
    for p in ('package.json', 'src/plugin.json'):
        s = read(p)
        s = re.sub(r'("version":\s*")[^"]+(")', rf'\g<1>{version}\2', s, count=1)
        write(p, s)
    lock = json.loads(read('package-lock.json'))
    lock['version'] = version
    lock['packages']['']['version'] = version
    write('package-lock.json', json.dumps(lock, indent=2, ensure_ascii=False) + '\n')

    pending.unlink()
    print(f'folded {spec} -> v{version}, D{top + 1}')


if __name__ == '__main__':
    main()
