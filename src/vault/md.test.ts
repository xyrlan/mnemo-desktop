import { parseBlocks, parseInline } from './md'

test('blocks: headings, paragraphs, lists, fences, quotes, rules; HTML comments dropped', () => {
  const md = [
    '# Title',
    '',
    'First line',
    'joined.',
    '- one',
    '  wrapped',
    '  - nested',
    '1. first',
    '```sh',
    'pnpm test',
    '  # not a heading',
    '```',
    '> quoted',
    '---',
    '<!-- mnemo:graph-section -->',
    '## Sources',
  ].join('\n')
  const b = parseBlocks(md)
  expect(b.map((x) => x.t)).toEqual(['heading', 'para', 'list', 'list', 'code', 'quote', 'rule', 'heading'])
  expect(b[1]).toEqual({ t: 'para', children: [{ t: 'text', text: 'First line joined.' }] })
  expect(b[2]).toEqual({
    t: 'list',
    ordered: false,
    items: [
      { depth: 0, children: [{ t: 'text', text: 'one wrapped' }] },
      { depth: 1, children: [{ t: 'text', text: 'nested' }] },
    ],
  })
  expect(b[3]).toMatchObject({ t: 'list', ordered: true })
  expect(b[4]).toEqual({ t: 'code', lang: 'sh', text: 'pnpm test\n  # not a heading' })
  expect(b[7]).toEqual({ t: 'heading', level: 2, children: [{ t: 'text', text: 'Sources' }] })
})

test('inline: code, bold, italic, links and wikilinks, earliest first', () => {
  expect(parseInline('**Why:** run `cargo test` in [[shared-target-dir|the dir]] or [docs](https://x.dev)')).toEqual([
    { t: 'strong', children: [{ t: 'text', text: 'Why:' }] },
    { t: 'text', text: ' run ' },
    { t: 'code', text: 'cargo test' },
    { t: 'text', text: ' in ' },
    { t: 'wiki', target: 'shared-target-dir', label: 'the dir' },
    { t: 'text', text: ' or ' },
    { t: 'link', href: 'https://x.dev', children: [{ t: 'text', text: 'docs' }] },
  ])
  expect(parseInline('*a* and _b_')).toEqual([
    { t: 'em', children: [{ t: 'text', text: 'a' }] },
    { t: 'text', text: ' and ' },
    { t: 'em', children: [{ t: 'text', text: 'b' }] },
  ])
})

test('inline leaves snake_case, lone markers and code contents alone', () => {
  expect(parseInline('silence_reason and 2 * 3')).toEqual([{ t: 'text', text: 'silence_reason and 2 * 3' }])
  expect(parseInline('`**not bold**`')).toEqual([{ t: 'code', text: '**not bold**' }])
})
