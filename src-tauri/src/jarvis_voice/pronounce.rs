//! What James says, written as it is to be heard (#530). Applied to a text right before it is
//! synthesized, so it changes only what is heard: captions and the panel keep the words as
//! written.
//!
//! The voice reads Portuguese spelling (espeak-ng's rules, which every engine tried read the same
//! way), so a word of English or a sign it misreads is spelled here as a Brazilian would say it.
//! Each spelling was chosen by the phonemes espeak-ng gives it (`kokoro.rs`, `live_pronunciation`)
//! and by what whisper hears of Kokoro saying it (`live_spellings`). Kokoro says "merge" right as
//! written, and every spelling of it tried was heard as "merde": it is not here.

/// Words read wrong, and how to spell them to be read right. Acronyms match as written; the
/// rest, in any case.
const WORDS: &[(&str, &str)] = &[
    // "cento e um", read as a Roman numeral.
    ("CI", "ci ai"),
    ("GPU", "gê pê u"),
    // "pê érre ésse".
    ("PRs", "pê érres"),
    // "parente".
    ("parent", "pérent"),
    ("parents", "pérents"),
    // "isúi", "ISUS".
    ("issue", "íchu"),
    ("issues", "íchus"),
    // "comiti": the `th` keeps the final t a t, where Portuguese makes it "tchi".
    ("commit", "comith"),
    ("commits", "comits"),
    // "Jâmis".
    ("James", "Djêims"),
    // "buio".
    ("build", "bíld"),
    ("builds", "bílds"),
    ("review", "riviú"),
    ("release", "rilíz"),
    ("pipeline", "páip láin"),
    ("feature", "fítcher"),
    ("rebase", "ribêiz"),
    ("main", "mêin"),
    ("GitHub", "guith rãb"),
    ("Claude", "clód"),
    ("worktree", "uôrktri"),
];

/// `text` as it is to be heard.
pub fn heard(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    let mut word = String::new();
    for c in text.chars() {
        if c.is_alphanumeric() {
            word.push(c);
            continue;
        }
        out.push_str(&say_word(&std::mem::take(&mut word)));
        out.push(c);
    }
    out.push_str(&say_word(&word));
    out
}

fn say_word(word: &str) -> String {
    if word.is_empty() {
        return String::new();
    }
    if let Some(time) = time(word) {
        return time;
    }
    let capitals = |w: &str| w.chars().all(|c| !c.is_lowercase());
    // A word in capitals is not the word: "MAIN" is not "main".
    let matches = |w: &str| if capitals(w) || capitals(word) { w == word } else { w.eq_ignore_ascii_case(word) };
    WORDS.iter().find(|(w, _)| matches(w)).map_or_else(|| word.to_string(), |(_, said)| said.to_string())
}

/// "7h38" as "7 e 38", "7h" as "7 horas", "7h05" as "7 e 5": else read "sete agá trinta e oito".
/// The hour is a feminine number ("uma", "duas").
fn time(word: &str) -> Option<String> {
    let (h, m) = word.split_once(['h', 'H'])?;
    if h.is_empty() || h.len() > 2 || !h.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if !(m.is_empty() || (m.len() == 2 && m.chars().all(|c| c.is_ascii_digit()))) {
        return None;
    }
    let hour: u32 = h.parse().ok()?;
    if hour > 24 {
        return None;
    }
    let spoken = match hour {
        1 => "uma".to_string(),
        2 => "duas".to_string(),
        21 => "vinte e uma".to_string(),
        22 => "vinte e duas".to_string(),
        n => n.to_string(),
    };
    let minutes: u32 = if m.is_empty() { 0 } else { m.parse().ok()? };
    if minutes > 59 {
        return None;
    }
    Some(match minutes {
        0 if hour == 1 => format!("{spoken} hora"),
        0 => format!("{spoken} horas"),
        m => format!("{spoken} e {m}"),
    })
}

/// The words the table spells, for the test that phonemizes them.
#[cfg(test)]
pub fn words() -> impl Iterator<Item = &'static str> {
    WORDS.iter().map(|(w, _)| *w)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_words_every_engine_misread_are_spelled_as_heard() {
        assert_eq!(heard("O CI passou."), "O ci ai passou.");
        assert_eq!(heard("Abri o parent e duas issues."), "Abri o pérent e duas íchus.");
        assert_eq!(heard("Fiz o commit, issue 42."), "Fiz o comith, íchu 42.");
        assert_eq!(heard("Issue aberta"), "íchu aberta", "any case, for a word");
        assert_eq!(heard("Os PRs do GitHub"), "Os pê érres do guith rãb");
    }

    #[test]
    fn an_acronym_matches_only_as_written_and_a_word_only_whole() {
        // "ci" and "Ci" are not CI; "CIA" is not CI.
        assert_eq!(heard("ci Ci CIA"), "ci Ci CIA");
        assert_eq!(heard("commitar recommit"), "commitar recommit");
        assert_eq!(heard("mnemo-desktop/main"), "mnemo-desktop/mêin");
        // "MAIN" written in capitals is read as a word, as written.
        assert_eq!(heard("MAIN"), "MAIN");
    }

    #[test]
    fn a_time_is_read_as_one() {
        assert_eq!(heard("às 7h38."), "às 7 e 38.");
        assert_eq!(heard("às 7h"), "às 7 horas");
        assert_eq!(heard("1h, 2h30, 21h05, 22h00"), "uma hora, duas e 30, vinte e uma e 5, vinte e duas horas");
        // Not times: left as written.
        assert_eq!(heard("7h60 25h 123h 7h3 h38 4K"), "7h60 25h 123h 7h3 h38 4K");
    }

    #[test]
    fn what_needs_nothing_is_left_as_it_is() {
        let text = "Olá! Tudo bem? O PR 42 passou em todas as verificações — às 7 e meia.";
        assert_eq!(heard(text), text);
        assert_eq!(heard(""), "");
    }
}
