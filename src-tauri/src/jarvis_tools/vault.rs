//! `search_vault` (#503): mnemo's vault searched by words. Every session briefing of any date
//! (`bots/<project>/briefings/sessions/`) and the vault's live notes (`shared/` and
//! `bots/<project>/memory/`, as `vault::live_pages` finds them), ranked by BM25.
//!
//! The briefings are written in English and the maintainer asks in Portuguese, so the brain
//! writes the query in both languages. Words are folded (lowercase, no accents), the words that
//! carry no subject (`de`, `que`, `the`) are dropped, and the rest are cut to a stem one
//! language shares with the other: `configuração`, `configuration` and `configured` are all
//! `configur`. A stem of four letters or more also finds the longer ones it starts (`erro`,
//! `error`). A Portuguese word with no English page to match scores nothing, and harms nothing.
//!
//! The index lives in memory, one per vault, and is brought up to date on every search: a
//! listing of the vault's folders, and only the files whose size or mtime changed are read
//! again. It keeps no text: a hit's lines are read from its file when it is shown.

use crate::jarvis::JarvisProject;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// How many pages a search shows.
const HITS: usize = 8;
/// How many windows of matching lines a hit shows, and how long a line may be.
const WINDOWS: usize = 3;
const LINE_CHARS: usize = 320;
/// The most one hit takes of `MAX_CHARS`.
const HIT_CHARS: usize = 2_400;
/// How many of the vocabulary's words a query word may stand for.
const ALTS: usize = 48;
/// What a longer word a stem starts counts for, against the stem itself.
const PREFIX_WEIGHT: f32 = 0.7;
/// BM25's constants.
const K1: f32 = 1.2;
const B: f32 = 0.75;

/// Index files that sit beside pages without being one, as `vault` skips them.
const NOT_PAGES: &[&str] = &["MEMORY.md", "README.md", "HOME.md", "INDEX.md"];

/// Words of either language that say nothing about a subject. Folded, as `words` yields them.
const STOP: &[&str] = &[
    // English
    "the", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from", "is", "are", "was", "were", "be", "been", "being", "it",
    "its", "this", "that", "these", "those", "as", "what", "which", "who", "whom", "how", "why", "when", "where", "did", "do", "does", "done", "we",
    "you", "he", "she", "they", "them", "our", "my", "your", "his", "her", "their", "us", "me", "about", "there", "here", "not", "no", "yes", "so",
    "if", "then", "than", "but", "can", "could", "would", "should", "will", "shall", "have", "has", "had", "any", "all", "some", "into", "out",
    "up", "also", "just", "only", "very", "more", "most", "such", "each", "other", "after", "before", "over", "again", "once", "now",
    // Portuguese
    "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas", "num", "numa", "por", "pelo", "pela",
    "pelos", "pelas", "para", "pra", "pro", "com", "sem", "que", "quem", "qual", "quais", "como", "quando", "onde", "porque", "ou", "mas",
    "se", "foi", "era", "ser", "estar", "esta", "estao", "tem", "ter", "teve", "tinha", "isso", "isto", "esse", "essa", "este", "esses", "essas",
    "estes", "estas", "aquele", "aquela", "aquilo", "sobre", "ao", "aos", "eu", "nos", "voce", "voces", "ele", "ela", "eles", "elas", "lhe",
    "meu", "minha", "nosso", "nossa", "seu", "sua", "seus", "suas", "ja", "nao", "sim", "mais", "muito", "muita", "tambem", "gente", "ai",
    "la", "aqui", "ali", "entao", "ate", "depois", "antes", "agora", "fez", "fiz", "fizemos", "feito", "algum", "alguma", "alguns", "coisa",
    "coisas", "vez", "ainda", "mesmo", "tudo", "todo", "toda", "todos", "todas", "sao", "seja", "pode", "onde", "lembra", "sabe", "diz", "me",
];

/// The suffixes `stem` cuts, longest of each family first, the language a word is in unknown:
/// English's and Portuguese's plurals, nouns of action, participles and the tenses a briefing
/// is told in (`funcionou`, `funcionava`, `funcionar` are all `funcion`).
const SUFFIXES: &[&str] = &[
    "acoes", "acao", "ations", "ation", "icoes", "icao", "mente", "idades", "idade", "ments", "ment", "ings", "ing", "ions", "ion", "ados",
    "adas", "idos", "idas", "ado", "ada", "ido", "ida", "ando", "endo", "indo", "aram", "eram", "iram", "avam", "amos", "emos", "imos", "ava",
    "iam", "edly", "ies", "ied", "oes", "ers", "ed", "er", "es", "ao", "os", "as", "ar", "ir", "ou", "eu", "iu", "ia", "s",
];

// ------------------------------------------------------------- words --

/// `c` lowercase and without its accent.
fn fold(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
        'ç' | 'Ç' => 'c',
        'ñ' | 'Ñ' => 'n',
        c if c.is_ascii() => c.to_ascii_lowercase(),
        c => c.to_lowercase().next().unwrap_or(c),
    }
}

/// The words of `text` that say something, folded and stopwords dropped, each with its stem.
fn words(text: &str, mut each: impl FnMut(&str, String)) {
    let mut w = String::new();
    let mut flush = |w: &mut String| {
        let n = w.chars().count();
        if (2..=40).contains(&n) && !STOP.contains(&w.as_str()) {
            let s = stem(w);
            each(w, s);
        }
        w.clear();
    };
    for c in text.chars() {
        if c.is_alphanumeric() {
            w.push(fold(c));
        } else if !w.is_empty() {
            flush(&mut w);
        }
    }
    if !w.is_empty() {
        flush(&mut w);
    }
}

/// A folded word cut to the stem English and Portuguese share: one suffix of `SUFFIXES`, never
/// below four letters. Digits are kept whole.
fn stem(w: &str) -> String {
    if w.bytes().all(|b| b.is_ascii_digit()) {
        return w.to_string();
    }
    SUFFIXES.iter().find(|s| w.len() >= s.len() + 4 && w.ends_with(*s)).map_or_else(|| w.to_string(), |s| w[..w.len() - s.len()].to_string())
}

// ------------------------------------------------------------- index --

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Briefing,
    Note,
}

/// A page as the index keeps it: what its hit says of it, and its stems' weighted counts.
struct Doc {
    /// Size and mtime when it was read: a change in either reads it again.
    stamp: (u64, u128),
    kind: Kind,
    /// The bot dir it lives under, or `shared`; a note promoted to `shared/` keeps the project
    /// its `agent` names (`shared/project/<project>__<slug>.md`).
    owner: String,
    /// A briefing's date, a note's type.
    label: String,
    /// A briefing's TL;DR, cut to its first sentence; a note's name.
    title: String,
    /// A briefing's session id; a note's description.
    about: String,
    /// A hash of the body: a note promoted to `shared/` keeps its body, and is one hit.
    body: u64,
    /// `(stem id, weighted count)`, by id.
    terms: Vec<(u32, f32)>,
    len: f32,
}

#[derive(Default)]
struct Index {
    docs: HashMap<PathBuf, Doc>,
    ids: HashMap<String, u32>,
    stems: Vec<String>,
    /// How many docs hold each stem.
    df: Vec<u32>,
    total_len: f64,
}

/// The pages a search reads: every briefing, and the live notes (`vault::live_pages`' set),
/// each with its kind, owner and stamp.
fn sources(root: &Path) -> Vec<(PathBuf, Kind, String, (u64, u128))> {
    fn stamp(e: &std::fs::DirEntry) -> Option<(u64, u128)> {
        let m = e.metadata().ok()?;
        let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
        Some((m.len(), t))
    }
    fn notes(dir: &Path, depth: usize, owner: &str, out: &mut Vec<(PathBuf, Kind, String, (u64, u128))>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('_') || name.starts_with('.') {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if depth > 1 {
                    notes(&e.path(), depth - 1, owner, out);
                }
            } else if name.ends_with(".md") && !NOT_PAGES.contains(&name.as_str()) {
                if let Some(s) = stamp(&e) {
                    out.push((e.path(), Kind::Note, owner.to_string(), s));
                }
            }
        }
    }
    let mut out = Vec::new();
    notes(&root.join("shared"), 2, "shared", &mut out);
    for bot in std::fs::read_dir(root.join("bots")).into_iter().flatten().flatten() {
        let name = bot.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || !bot.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        if !crate::vault::is_noise(&name) {
            notes(&bot.path().join("memory"), 2, &name, &mut out);
        }
        for e in std::fs::read_dir(bot.path().join("briefings").join("sessions")).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().ends_with(".md") && e.file_type().is_ok_and(|t| t.is_file()) {
                if let Some(s) = stamp(&e) {
                    out.push((e.path(), Kind::Briefing, name.clone(), s));
                }
            }
        }
    }
    out
}

fn field<'a>(page: &'a crate::vault::Page, key: &str) -> Option<&'a str> {
    page.frontmatter.iter().find(|f| f.key == key).map(|f| f.value.trim()).filter(|v| !v.is_empty())
}

/// A briefing's TL;DR up to its first sentence's end, at most 200 characters.
fn first_sentence(text: &str) -> String {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let end = t.char_indices().skip(20).find(|&(i, c)| c == '.' && t[i + 1..].starts_with(' ')).map_or(t.len(), |(i, _)| i + 1);
    let s = &t[..end];
    if s.chars().count() > 200 {
        format!("{} …", s.chars().take(200).collect::<String>().trim_end())
    } else {
        s.to_string()
    }
}

impl Index {
    fn id(&mut self, stem: String) -> u32 {
        if let Some(&id) = self.ids.get(&stem) {
            return id;
        }
        let id = self.stems.len() as u32;
        self.stems.push(stem.clone());
        self.df.push(0);
        self.ids.insert(stem, id);
        id
    }

    /// A page read and counted; None when it cannot be read.
    fn read(&mut self, path: &Path, kind: Kind, owner: String, stamp: (u64, u128)) -> Option<Doc> {
        let bytes = std::fs::read(path).ok()?;
        let page = crate::vault::parse_page(path, &String::from_utf8_lossy(&bytes), None);
        let i = &page.info;
        let owner = match field(&page, "agent") {
            Some(agent) if kind == Kind::Note && owner == "shared" && agent != "shared" => agent.to_string(),
            _ => owner,
        };
        let mut counts: HashMap<u32, f32> = HashMap::new();
        let mut len = 0.0;
        let mut add = |ix: &mut Index, text: &str, weight: f32, len: &mut f32| {
            words(text, |_, s| {
                *counts.entry(ix.id(s)).or_default() += weight;
                *len += 1.0;
            })
        };
        let (label, title, about) = match kind {
            Kind::Briefing => {
                let tldr = crate::memory_feed::tldr(&i.body);
                // The TL;DR says what the session was about: it counts twice.
                add(self, &tldr, 1.0, &mut len);
                let date = field(&page, "date").map(|d| d.chars().take(10).collect()).unwrap_or_else(|| "undated".to_string());
                let session = field(&page, "session_id").map_or_else(|| i.slug.clone(), str::to_string);
                (date, first_sentence(&tldr), session)
            }
            Kind::Note => {
                add(self, &i.name.replace(['-', '_'], " "), 2.0, &mut len);
                add(self, &i.description, 1.0, &mut len);
                add(self, &i.topics.join(" "), 1.0, &mut len);
                (i.page_type.clone(), i.name.clone(), i.description.clone())
            }
        };
        add(self, &i.body, 1.0, &mut len);
        let mut terms: Vec<(u32, f32)> = counts.into_iter().collect();
        terms.sort_unstable_by_key(|t| t.0);
        let body = {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            i.body.trim().hash(&mut h);
            h.finish()
        };
        Some(Doc { stamp, kind, owner, label, title, about, body, terms, len })
    }

    fn insert(&mut self, path: PathBuf, doc: Doc) {
        for &(id, _) in &doc.terms {
            self.df[id as usize] += 1;
        }
        self.total_len += f64::from(doc.len);
        if let Some(old) = self.docs.insert(path, doc) {
            self.forget(&old);
        }
    }

    fn forget(&mut self, doc: &Doc) {
        for &(id, _) in &doc.terms {
            self.df[id as usize] -= 1;
        }
        self.total_len -= f64::from(doc.len);
    }

    /// The index brought up to the vault's files: new and changed ones read, gone ones dropped.
    fn refresh(&mut self, root: &Path) {
        let found = sources(root);
        let seen: HashSet<&PathBuf> = found.iter().map(|f| &f.0).collect();
        let gone: Vec<PathBuf> = self.docs.keys().filter(|p| !seen.contains(p)).cloned().collect();
        for p in gone {
            if let Some(d) = self.docs.remove(&p) {
                self.forget(&d);
            }
        }
        for (path, kind, owner, stamp) in found {
            if self.docs.get(&path).is_some_and(|d| d.stamp == stamp) {
                continue;
            }
            match self.read(&path, kind, owner, stamp) {
                Some(doc) => self.insert(path, doc),
                None => {
                    if let Some(d) = self.docs.remove(&path) {
                        self.forget(&d);
                    }
                }
            }
        }
    }

    fn idf(&self, id: u32) -> f32 {
        let n = self.docs.len() as f32;
        let df = self.df[id as usize] as f32;
        (1.0 + (n - df + 0.5) / (df + 0.5)).ln()
    }

    /// The query's words, each with the stems of the vocabulary it stands for: its own; when it
    /// has four letters or more, the longer ones it starts, the most common first; and the
    /// shorter ones of five letters or more it starts with, short of up to three (`assinante`
    /// is `assinant`, a stem cut can miss a form `SUFFIXES` does not know).
    fn query(&self, query: &str) -> Vec<Word> {
        let mut out: Vec<Word> = Vec::new();
        words(query, |_, s| {
            if out.iter().any(|w| w.stem == s) {
                return;
            }
            let mut alts: Vec<(u32, f32)> = Vec::new();
            if let Some(&id) = self.ids.get(&s) {
                if self.df[id as usize] > 0 {
                    alts.push((id, 1.0));
                }
            }
            if s.chars().count() >= 4 && !s.bytes().all(|b| b.is_ascii_digit()) {
                let mut longer: Vec<u32> = self
                    .stems
                    .iter()
                    .enumerate()
                    .filter(|(i, t)| t.len() > s.len() && t.starts_with(s.as_str()) && self.df[*i] > 0)
                    .map(|(i, _)| i as u32)
                    .collect();
                longer.sort_unstable_by_key(|&i| std::cmp::Reverse(self.df[i as usize]));
                alts.extend(longer.into_iter().take(ALTS).map(|i| (i, PREFIX_WEIGHT)));
                let ends: Vec<usize> = s.char_indices().map(|(i, _)| i).filter(|&i| i >= 5 && i + 3 >= s.len()).collect();
                alts.extend(ends.into_iter().filter_map(|i| self.ids.get(&s[..i])).filter(|&&id| self.df[id as usize] > 0).map(|&id| (id, PREFIX_WEIGHT)));
            }
            out.push(Word { stems: alts.iter().map(|&(i, _)| self.stems[i as usize].clone()).collect(), idf: alts.iter().map(|&(i, _)| self.idf(i)).fold(0.0, f32::max), alts, stem: s });
        });
        out
    }

    /// The docs `keep` lets through that hold a word of `q`, best first, a body shown once.
    fn rank(&self, q: &[Word], keep: impl Fn(&Doc) -> bool) -> Vec<(&PathBuf, &Doc, f32)> {
        let avg = if self.docs.is_empty() { 1.0 } else { (self.total_len / self.docs.len() as f64) as f32 };
        let idfs: Vec<Vec<f32>> = q.iter().map(|w| w.alts.iter().map(|&(i, _)| self.idf(i)).collect()).collect();
        let mut hits: Vec<(&PathBuf, &Doc, f32)> = self
            .docs
            .iter()
            .filter(|(_, d)| keep(d))
            .filter_map(|(p, d)| {
                let norm = K1 * (1.0 - B + B * d.len / avg);
                let score: f32 = q
                    .iter()
                    .zip(&idfs)
                    .map(|(w, idf)| {
                        w.alts.iter().zip(idf).fold(0.0, |best: f32, (&(id, weight), idf)| match d.terms.binary_search_by_key(&id, |t| t.0) {
                            Ok(k) => {
                                let tf = d.terms[k].1;
                                best.max(weight * idf * tf * (K1 + 1.0) / (tf + norm))
                            }
                            Err(_) => best,
                        })
                    })
                    .sum();
                (score > 0.0).then_some((p, d, score))
            })
            .collect();
        hits.sort_by(|a, b| b.2.total_cmp(&a.2).then_with(|| b.1.label.cmp(&a.1.label)).then_with(|| a.0.cmp(b.0)));
        let mut seen = HashSet::new();
        hits.retain(|h| seen.insert(h.1.body));
        hits
    }
}

/// A word of the query: its stem, the vocabulary's stems it stands for with their weights, and
/// the rarest one's idf, which is what a line holding it is worth.
struct Word {
    stem: String,
    alts: Vec<(u32, f32)>,
    stems: HashSet<String>,
    idf: f32,
}

/// One index per vault: the app has one, and each test its own, so that a search of one vault
/// never starts another's index over.
static INDEX: Mutex<Option<HashMap<PathBuf, Index>>> = Mutex::new(None);

/// Runs `f` over the index of `root`, brought up to date first.
fn with_index<T>(root: &Path, f: impl FnOnce(&Index) -> T) -> T {
    let mut slot = INDEX.lock().unwrap_or_else(|e| e.into_inner());
    let index = slot.get_or_insert_with(HashMap::new).entry(root.to_path_buf()).or_default();
    index.refresh(root);
    f(index)
}

/// Builds the index of the app's vault on a thread of its own, once per run: the first search
/// would read every page (a second over the maintainer's vault), so a request's first step,
/// asking which window is in front, starts it while the brain thinks.
pub fn warm() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        std::thread::spawn(|| {
            if let Some(root) = crate::vault::vault_root() {
                with_index(&root, |_| ());
            }
        });
    });
}

// ------------------------------------------------------------ search --

/// Whether a page of `owner` belongs to `p`: its own bot dir or one of its worktrees'.
fn owned_by(owner: &str, p: &JarvisProject) -> bool {
    let (o, n) = (owner.to_lowercase(), p.name.to_lowercase());
    o == n || o.starts_with(&format!("{n}-wt-"))
}

/// The pages of `vault` that best match `query`, of `p` and the shared ones or of every
/// project, best first: their paths and scores. What the tests and the eval measure.
#[cfg(test)]
pub fn rank(vault: &Path, p: Option<&JarvisProject>, query: &str) -> Vec<(PathBuf, f32)> {
    with_index(vault, |ix| {
        let q = ix.query(query);
        ix.rank(&q, |d| p.map_or(true, |p| d.owner == "shared" || owned_by(&d.owner, p))).into_iter().map(|(path, _, s)| (path.clone(), s)).collect()
    })
}

/// `search_vault`: the pages of `vault` that best match `query`, best first, as text for the
/// model. Each says what it is (a briefing, its project and date; a note, its kind), its title,
/// and the lines that matched with the ones around them.
pub fn search(vault: &Path, p: Option<&JarvisProject>, query: &str) -> Result<String, String> {
    let whose = p.map_or("every project".to_string(), |p| format!("{} and the shared notes", p.name));
    with_index(vault, |ix| {
        let q = ix.query(query);
        if q.is_empty() {
            return Ok(format!("\"{}\" has no word to search the vault for: name the subject", query.trim()));
        }
        let hits = ix.rank(&q, |d| p.map_or(true, |p| d.owner == "shared" || owned_by(&d.owner, p)));
        if hits.is_empty() {
            return Ok(format!("nothing in the vault ({whose}) matches \"{}\"", query.trim()));
        }
        let shown = hits.len().min(HITS);
        let budget = ((crate::jarvis_tools::MAX_CHARS - 300) / shown).min(HIT_CHARS);
        let parts: Vec<String> = hits.iter().take(shown).enumerate().map(|(n, (path, d, _))| hit(n + 1, path, d, &q, budget)).collect();
        Ok(format!("the vault's pages ({whose}) for \"{}\", best first ({shown} of {} matching):\n\n{}", query.trim(), hits.len(), parts.join("\n\n")))
    })
}

/// One hit: what it is, its title, and its best lines, at most `budget` characters.
fn hit(n: usize, path: &Path, d: &Doc, q: &[Word], budget: usize) -> String {
    let head = match d.kind {
        Kind::Briefing => {
            let session = d.about.get(..8).unwrap_or(&d.about);
            format!("### {n}. briefing of {}, {} (session {session})\n{}", d.owner, d.label, d.title)
        }
        Kind::Note => {
            let about = if d.about.is_empty() { String::new() } else { format!("\n{}", d.about) };
            format!("### {n}. note ({}, {}): {}{about}", d.label, d.owner, d.title)
        }
    };
    let body = std::fs::read(path).ok().map(|b| crate::vault::parse_page(path, &String::from_utf8_lossy(&b), None).info.body).unwrap_or_default();
    let lines = excerpt(&body, q, &d.title);
    let text = if lines.is_empty() { head } else { format!("{head}\n{lines}") };
    if text.chars().count() <= budget {
        return text;
    }
    let mut cut: String = text.chars().take(budget.saturating_sub(2)).collect();
    if let Some(nl) = cut.rfind('\n').filter(|&nl| nl >= cut.len() / 2) {
        cut.truncate(nl);
    }
    format!("{cut} …")
}

/// The words of `q` a line holds, by index.
fn held(line: &str, q: &[Word]) -> Vec<usize> {
    let mut found = Vec::new();
    words(line, |_, s| {
        for (i, w) in q.iter().enumerate() {
            if !found.contains(&i) && (w.stem == s || w.stems.contains(&s)) {
                found.push(i);
            }
        }
    });
    found
}

/// The body's lines that hold the most of `q`'s rare words, each with the line that says
/// something before and after it, in the page's order; windows apart are split by `…`. A line
/// too long is cut around the first word it holds; what repeats `title` is left out.
fn excerpt(body: &str, q: &[Word], title: &str) -> String {
    let lines: Vec<&str> = body.lines().collect();
    let shown = |i: usize| !lines[i].trim().is_empty() && !lines[i].trim_start().starts_with("# ");
    let worth: Vec<f32> = (0..lines.len()).map(|i| if shown(i) { held(lines[i], q).iter().map(|&k| q[k].idf).sum() } else { 0.0 }).collect();
    let mut best: Vec<usize> = (0..lines.len()).filter(|&i| worth[i] > 0.0 && lines[i].trim() != title).collect();
    best.sort_by(|&a, &b| worth[b].total_cmp(&worth[a]).then(a.cmp(&b)));
    let mut keep: Vec<usize> = Vec::new();
    for i in best.into_iter().take(WINDOWS) {
        keep.extend((0..i).rev().find(|&j| shown(j)));
        keep.push(i);
        keep.extend((i + 1..lines.len()).find(|&j| shown(j)));
    }
    keep.sort_unstable();
    keep.dedup();
    let mut out: Vec<String> = Vec::new();
    for (n, &i) in keep.iter().enumerate() {
        if n > 0 && (keep[n - 1] + 1..i).any(shown) {
            out.push("…".to_string());
        }
        // A briefing's title is its TL;DR's first sentence: said once.
        let line = lines[i].trim_end();
        let line = line.trim_start().strip_prefix(title).filter(|_| !title.is_empty()).map_or(line, str::trim_start);
        if !line.is_empty() {
            out.push(clip(line, q));
        }
    }
    out.join("
")
}

/// `line`, or `LINE_CHARS` of it around the first word of `q` it holds.
fn clip(line: &str, q: &[Word]) -> String {
    let n = line.chars().count();
    if n <= LINE_CHARS {
        return line.to_string();
    }
    let chars: Vec<char> = line.chars().collect();
    // Where the first held word starts, in characters.
    let mut at = 0;
    let mut start = None;
    let mut w = String::new();
    for (k, &c) in chars.iter().chain(std::iter::once(&' ')).enumerate() {
        if c.is_alphanumeric() {
            if w.is_empty() {
                at = k;
            }
            w.push(fold(c));
        } else if !w.is_empty() {
            let s = stem(&w);
            if q.iter().any(|x| x.stem == s || x.stems.contains(&s)) {
                start = Some(at);
                break;
            }
            w.clear();
        }
    }
    // From and to a space, unless a word is longer than a tenth of the line.
    let mut from = start.unwrap_or(0).saturating_sub(LINE_CHARS / 4).min(n - LINE_CHARS);
    if from > 0 {
        from = (from..from + LINE_CHARS / 10).find(|&k| chars[k - 1] == ' ').unwrap_or(from);
    }
    let mut to = (from + LINE_CHARS).min(n);
    if to < n {
        to = (to - LINE_CHARS / 10..=to).rev().find(|&k| chars[k] == ' ').unwrap_or(to);
    }
    format!("{}{}{}", if from > 0 { "… " } else { "" }, chars[from..to].iter().collect::<String>().trim(), if to < n { " …" } else { "" })
}

#[cfg(test)]
mod tests;
