"""Hold the synthetic capture to the shape of the real one, and both to DATA.md's rules.

    python check.py            # data.sample.js alone, or against data.js when it exists

A concept is written against `data.sample.js` and judged on `data.js`; a key the sample
lacks, or carries with another type, is a page that breaks on the maintainer's screen.
Exit code 1 on any difference.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STATES = {'need', 'working', 'ready', 'idle', 'stalled', 'ended'}
PENDING = {'question', 'permission', 'blocked', 'merge', 'stalled'}


def load(name):
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        return None
    text = open(path, encoding='utf-8').read().strip()
    return json.loads(text[len('window.MNEMO = '):].rstrip(';'))


def shape(value, path, out):
    """Every key path with the set of JSON types seen at it; list items share one path."""
    kind = type(value).__name__
    out.setdefault(path, set()).add(kind)
    if isinstance(value, dict):
        # maps keyed by data (a model id, a tool kind, a project) are one path, not many
        keyed = path.endswith(('.byModel', '.activityCounts', '.kinds', '.projectXp', '.outcomes'))
        for k, v in value.items():
            shape(v, path + ('.*' if keyed else '.' + k), out)
    elif isinstance(value, list):
        for v in value:
            shape(v, path + '[]', out)


def rules(data, name):
    errors = []
    ids = {s['id'] for s in data['sessions']}
    for s in data['sessions']:
        if s['state'] not in STATES:
            errors.append('%s: session %s has state %r' % (name, s['short'], s['state']))
        for c in s['children']:
            if c not in ids:
                errors.append('%s: session %s lists a child that is not in the capture' % (name, s['short']))
        if s['parent'] in ids and s['id'] not in next(p for p in data['sessions'] if p['id'] == s['parent'])['children']:
            errors.append('%s: session %s is not among its parent\'s children' % (name, s['short']))
        c = s['context']
        if c and c['tokens'] is not None and not 0 <= c['tokens'] <= c['window'] * 1.05:
            errors.append('%s: session %s has %s context tokens in a window of %s' % (name, s['short'], c['tokens'], c['window']))
    for p in data['pending']:
        if p['kind'] not in PENDING:
            errors.append('%s: pending kind %r' % (name, p['kind']))
        if p['session'] not in ids:
            errors.append('%s: a pending row names a session that is not in the capture' % name)
    return errors


def main():
    sample, real = load('data.sample.js'), load('data.js')
    if sample is None:
        sys.exit('data.sample.js is missing; run sample.py')
    errors = rules(sample, 'sample')
    if real is not None:
        errors += rules(real, 'real')
        a, b = {}, {}
        shape(sample, '$', a)
        shape(real, '$', b)
        for path in sorted(set(b) - set(a)):
            errors.append('the real capture has %s, the sample does not' % path)
        for path in sorted(set(a) - set(b)):
            # a list that is empty, or an object that is null, on this machine today hides its keys
            parts = path.split('.')
            above = ['.'.join(parts[:i]).rstrip('[]') for i in range(1, len(parts) + 1)] + [path.rstrip('[]')]
            if any(p in b and b[p] <= {'list', 'NoneType'} for p in above):
                continue
            errors.append('the sample has %s, the real capture does not' % path)
        for path in sorted(set(a) & set(b)):
            only = (b[path] - a[path]) - {'NoneType'}
            if only and not (only <= {'int', 'float'} and a[path] & {'int', 'float'}):
                errors.append('%s is %s in the real capture and only %s in the sample' % (path, sorted(b[path]), sorted(a[path])))
    for e in errors:
        print(e)
    print('%d difference(s)%s' % (len(errors), '' if real is not None else ' (no data.js here: the sample was checked alone)'))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
