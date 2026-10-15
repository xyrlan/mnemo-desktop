"""Snapshot the real fleet over a time window for the Nexus v2 prototype's replay.

Children come from `mnemo sessions --json --all --stale`, live parents from `claude agents
--json`, and every session's transcript gives its timestamped actions. Writes `fleet.js`
(`window.FLEET = …`) so the page opens from file:// with no server."""
import glob, json, os, re, subprocess, sys, time
from datetime import datetime, timezone

OUT = sys.argv[1]
WINDOW_H = float(sys.argv[2]) if len(sys.argv) > 2 else 36
HOME = os.path.expanduser('~')
NOW = time.time()
START = NOW - WINDOW_H * 3600


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True, encoding='utf-8', errors='replace').stdout


def ts(iso):
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def transcript(sid):
    hits = glob.glob(f'{HOME}/.claude*/projects/*/{sid}.jsonl')
    return max(hits, key=os.path.getsize) if hits else None


def short(s, n):
    s = re.sub(r'\s+', ' ', s or '').strip()
    return s if len(s) <= n else s[: n - 1] + '…'


def home(s):
    return (s or '').replace(HOME, '~')


def clip(text, lines=60, chars=4000):
    """Enough of an edit to show its diff, never the whole file a Write put down."""
    text = home(text)
    ls = text.splitlines()
    out = '\n'.join(ls[:lines])
    if len(ls) > lines:
        out += f'\n… +{len(ls) - lines} linhas'
    return out[:chars]


def tool_target(name, inp):
    inp = inp or {}
    if name in ('SendMessage',) and inp.get('message'):
        return short(home(str(inp['message'])), 160)
    if name == 'AskUserQuestion':
        qs = inp.get('questions') or []
        return short(qs[0].get('question', '') if qs else '', 200)
    for k in ('command', 'file_path', 'pattern', 'description', 'prompt', 'url', 'query', 'skill', 'path', 'notebook_path'):
        if inp.get(k):
            v = str(inp[k])
            if k in ('file_path', 'path', 'notebook_path'):
                v = v.rstrip('/').rsplit('/', 1)[-1]
            return short(home(v), 90)
    return ''


def read_log(path, since):
    """Timestamped entries of one transcript at or after `since`, plus the last model seen."""
    model, out, first, last = None, [], None, None
    usage, seen = [], set()
    if not path:
        return model, out, first, last, usage
    with open(path, 'rb') as f:
        lines = f.read().decode('utf-8', 'replace').splitlines()
    for line in lines:
        try:
            o = json.loads(line)
        except Exception:
            continue
        t, msg = o.get('type'), o.get('message') or {}
        if t not in ('user', 'assistant') or o.get('isMeta'):
            continue
        at = ts(o.get('timestamp'))
        if at is None:
            continue
        first = first or at
        last = at
        if t == 'assistant' and str(msg.get('model') or '').startswith('claude'):
            model = msg['model']
        u = msg.get('usage') if t == 'assistant' else None
        if u and msg.get('id') not in seen and at >= since:
            seen.add(msg.get('id'))
            usage.append([round(at, 1), u.get('output_tokens') or 0, u.get('input_tokens') or 0,
                          u.get('cache_read_input_tokens') or 0, u.get('cache_creation_input_tokens') or 0])
        c = msg.get('content')
        if isinstance(c, str):
            c = [{'type': 'text', 'text': c}]
        for b in c or []:
            bt = b.get('type')
            if bt == 'text':
                txt = b.get('text', '')
                if t == 'user':
                    if '<mnemo-child-finished' in txt or '<agent-message' in txt or '<task-notification' in txt:
                        out.append({'k': 'peer', 't': short(home(re.sub(r'<[^>]+>', ' ', txt)), 260), 'at': at})
                        continue
                    if txt.lstrip().startswith('<') or 'system-reminder' in txt[:300] or 'Caveat:' in txt[:20]:
                        continue
                    out.append({'k': 'user', 't': short(home(txt), 400), 'at': at})
                else:
                    out.append({'k': 'say', 't': short(home(txt), 400), 'at': at})
            elif bt == 'tool_use':
                e = {'k': 'tool', 'n': b.get('name'), 't': tool_target(b.get('name'), b.get('input')), 'at': at}
                inp = b.get('input') or {}
                if b.get('name') in ('Edit', 'MultiEdit', 'Write'):
                    e['p'] = home(inp.get('file_path') or '')
                    edits = inp.get('edits') or [inp]
                    e['d'] = [{'o': clip(x.get('old_string') or ''), 'n': clip(x.get('new_string') if 'new_string' in x else x.get('content') or '')} for x in edits][:6]
                    if b.get('name') == 'Write':
                        e['w'] = True
                out.append(e)
            elif bt == 'tool_result':
                rc = b.get('content')
                if isinstance(rc, list):
                    rc = ' '.join(x.get('text', '') for x in rc if isinstance(x, dict))
                first_line = next((l for l in str(rc or '').splitlines() if l.strip()), '')
                out.append({'k': 'res', 't': short(home(first_line), 120), 'err': bool(b.get('is_error')), 'at': at})
    keep = [e for e in out if e['at'] >= since]
    if len(keep) < 40:
        keep = out[-40:]
    return model, keep[-5000:], first, last, usage


def timeline(short_id):
    rows, prev = [], None
    for path in glob.glob(f'{HOME}/.claude*/jobs/{short_id}/timeline.jsonl'):
        for line in open(path, encoding='utf-8', errors='replace'):
            try:
                o = json.loads(line)
            except Exception:
                continue
            d, at = home(o.get('detail') or ''), ts(o.get('at'))
            if d and at and d != prev:
                rows.append({'at': at, 't': short(d, 140), 's': o.get('state')})
                prev = d
    return rows


def contract_of(intent):
    """A contract piece's prompt names its feature, its piece, and the pieces whose signatures it writes against."""
    m = re.search(r'one piece of the feature "([^"]+)": (\S+)', intent or '')
    if not m:
        return None
    return {'feature': m.group(1), 'piece': m.group(2), 'consumes': sorted(set(re.findall(r'from the piece `([^`]+)`', intent)))}


def klass(model):
    m = (model or '').lower()
    return 'mech' if 'opus' in m else 'droid' if 'sonnet' in m else 'drone' if 'haiku' in m else 'unknown'


def repo_of(cwd):
    return re.sub(r'-wt-.*$', '', os.path.basename((cwd or '').rstrip('/')))


def issue_of(intent, name, cwd):
    m = re.search(r'issue #(\d+)', intent or '') or re.search(r'-wt-(\d+)', cwd or '')
    return f'#{m.group(1)}' if m else ''


def title_of(intent):
    m = re.search(r'issue #\d+ in this repo: (.+)', intent or '')
    if m:
        return short(m.group(1).splitlines()[0], 120)
    return short((intent or '').splitlines()[0] if intent else '', 120)


agents = json.loads(sh('claude', 'agents', '--json') or '[]')
sessions = json.loads(sh('mnemo', 'sessions', '--json', '--all', '--stale') or '[]')
live_status = {a['sessionId']: a.get('status') for a in agents}
names = {a['sessionId']: a.get('name') for a in agents}

children = []
for s in sessions:
    up = ts(s.get('updated_at'))
    if not s.get('live') and (up is None or up < START):
        continue
    model, log, first, last, usage = read_log(transcript(s['session_id']), START)
    if not first:
        continue
    pr = next((c for c in s.get('children') or [] if c.get('kind') == 'pr'), None)
    children.append({
        'id': s['session_id'], 'short': s['short_id'], 'parent': s.get('parent_session'), 'repo': repo_of(s['cwd']),
        'issue': issue_of(s.get('intent'), s.get('name'), s.get('cwd')), 'title': title_of(s.get('intent')),
        'name': s.get('name'), 'state': s.get('state'), 'live': bool(s.get('live')),
        'status': live_status.get(s['session_id']), 'detail': home(s.get('detail') or ''),
        'needs': s.get('needs'), 'suggested_reply': s.get('suggested_reply'), 'pr': pr,
        'model': model or s.get('model'), 'klass': klass(model or s.get('model')),
        'tokens': s.get('context_tokens'), 'first': first, 'last': last, 'log': log,
        'timeline': timeline(s['short_id']), 'usage': usage, 'contract': contract_of(s.get('intent')),
    })

parent_ids = {a['sessionId'] for a in agents if a.get('kind') == 'interactive'}
parent_ids |= {c['parent'] for c in children if c['parent']}
child_ids = {c['id'] for c in children}
parents = []
for sid in parent_ids:
    if sid in child_ids:  # a child that dispatched grandchildren is drawn as a child
        continue
    path = transcript(sid)
    model, log, first, last, usage = read_log(path, START)
    cwd = next((a['cwd'] for a in agents if a['sessionId'] == sid), None)
    if not cwd and path:
        cwd = os.path.basename(os.path.dirname(path)).replace('-Users-' + os.path.basename(HOME) + '-github-', '')
    parents.append({
        'id': sid, 'short': sid[:8], 'name': names.get(sid) or f'{repo_of(cwd)}·{sid[:4]}', 'repo': repo_of(cwd),
        'live': sid in live_status, 'status': live_status.get(sid) or 'dead', 'model': model, 'klass': klass(model),
        'first': first, 'last': last, 'log': log, 'usage': usage,
    })

# the real fate of every PR: merged or closed when, and when each check ran
def pr_state(c):
    out = sh('gh', 'pr', 'view', c['pr']['href'], '--json', 'state,mergedAt,closedAt,statusCheckRollup')
    try:
        j = json.loads(out)
    except ValueError:
        return
    c['pr'].update(state=j.get('state'), mergedAt=ts(j.get('mergedAt')), closedAt=ts(j.get('closedAt')),
                   checks=[[ts(k.get('startedAt')), ts(k.get('completedAt')), k.get('conclusion') or k.get('state')]
                           for k in j.get('statusCheckRollup') or []])
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(8) as pool:
    list(pool.map(pr_state, [c for c in children if c['pr'] and c['pr'].get('href')]))

data = {'now': NOW, 'start': START, 'parents': parents, 'children': children}
with open(OUT, 'w') as f:
    f.write('window.FLEET = ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(f'{len(parents)} parents, {len(children)} children, {os.path.getsize(OUT) / 1e6:.1f} MB -> {OUT}')
