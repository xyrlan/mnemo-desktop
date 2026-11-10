"""Photograph the console's states with ../shot.py, and fail on any console error.

    python console/shots.py            # the sample capture
    python console/shots.py --real     # this machine's data.js

The sample's main states go to console/shots-sample/ (committed); its other states, and
every picture of real data, go to ../shots/console/ (gitignored). The sample states name
sessions of `data.sample.js`. The real pass cannot name a session it has not seen, so it
reads `data.js` and puts its first sessions on stage, one per instrument and size.
Every state is one URL: the view is the hash (NOTES.md lists its keys).
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BIG, MID, SMALL = '2560x1440', '1920x1080', '1366x768'
DREW = re.compile(r'mnemo console drew \d+ sessions, \d+ waiting, (styled|UNSTYLED)')

# name, hash, size. SAMPLE is committed; MORE is checked for errors and kept out of the repo.
SAMPLE = [
    ('01-roster-stage-instruments', 's=2f051967', BIG),
    ('02-question-armed', 's=493cbd64', BIG),
    ('03-child-permission-armed', 's=650506f6', BIG),
    ('04-by-project', 's=5efebf83&g=project', BIG),
    ('05-command-line', 's=2f051967&cmd=merge%20', BIG),
    ('06-terminal-takes-the-room', 's=2f051967&z=1&t=1', BIG),
    ('07-all-answered', 's=2f051967&a=0.0-1.0-2.0-3.0-4.0', BIG),
    ('08-1920-memory', 's=5efebf83&i=memory', MID),
    ('09-1366-context', 's=493cbd64', SMALL),
]
MORE = [
    ('sample-answered-three', 's=493cbd64&a=0.0-3.0-4.1', BIG),
    ('sample-keys', 's=2f051967&help=1', BIG),
    ('sample-screenshot-enlarged', 's=2f051967&shot=1', BIG),
    ('sample-1920-sight', 's=2f051967&i=sight', MID),
    ('sample-1366-memory', 's=2f051967&i=memory', SMALL),
    ('sample-1366-child', 's=841cb39e&i=sight', SMALL),
]


def real_states():
    path = os.path.join(ROOT, 'data.js')
    if not os.path.exists(path):
        sys.exit('no data.js: run python capture.py first')
    text = open(path, encoding='utf-8').read().strip()
    data = json.loads(text[len('window.MNEMO = '):].rstrip(';'))
    ids = {s['id'] for s in data['sessions']}
    roots = [s for s in data['sessions'] if s['parent'] not in ids]
    kids = [s for s in data['sessions'] if s['parent'] in ids]
    out = [('real-default', '', BIG), ('real-default-1920', '', MID), ('real-default-1366', '', SMALL),
           ('real-by-project', 'g=project', BIG), ('real-command-line', 'cmd=', BIG)]
    for i, s in enumerate(roots[:6] + kids[:3]):
        inst = ['context', 'memory', 'sight'][i % 3]
        out.append(('real-%02d-%s' % (i, inst), 's=%s&i=%s' % (s['short'], inst), [BIG, MID, SMALL][i % 3]))
    return out


def shoot(states, out, query):
    os.makedirs(out, exist_ok=True)
    failed = 0
    for name, state, size in states:
        url = 'console/index.html' + query + ('#' + state if state else '')
        run = subprocess.run([sys.executable, os.path.join(ROOT, 'shot.py'), url, os.path.join(out, name + '.png'), '--size', size],
                             cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        # shot.py fails on a console error; a page that never drew logs none, so ask for its own line
        drew = DREW.search(run.stdout)
        if run.returncode != 0:
            why = run.stdout.strip()
        elif not drew:
            why = 'the page did not draw'
        else:
            why = '' if drew.group(1) == 'styled' else 'the page drew without its stylesheet'
        print('%-32s %-10s %s' % (name, size, 'FAILED: ' + why if why else 'ok'))
        failed += bool(why)
    print('%d state(s), %d failed, in %s' % (len(states), failed, os.path.relpath(out, ROOT)))
    return failed


def main():
    private = os.path.join(ROOT, 'shots', 'console')
    if '--real' in sys.argv:
        failed = shoot(real_states(), private, '')
    else:
        failed = shoot(SAMPLE, os.path.join(HERE, 'shots-sample'), '?data=sample') + shoot(MORE, private, '?data=sample')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
