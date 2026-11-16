# Thai Practice: how to update this app

A static PWA (no build step) hosted on GitHub Pages from `main`. The owner sends photos of their Thai homework and notes in batches. Each batch becomes new or extended lesson files. The app has no AI inside and never calls an API.

## Files
- `data/index.json`: ordered list of lesson files. Add new files here.
- `data/lessons/NN-slug.json`: one lesson each: `id`, `title`, `source`, `notes[]`, `generators[]`, `vocab[[rom, thai, english]]`, `sentences[[rom, thai, english]]`, `qa[{ctx, q, a}]`.
  - In `sentences`, wrap the drilled word in `[brackets]`. That makes a fill-the-gap card. Every sentence with Thai script also becomes a listening card.
  - Optional 4th item in a sentence = an emoji. That adds a "which picture matches?" recall card (like the book's milestone pages). Keep emojis unique within a lesson.
  - Optional `nouns[[rom, thai, english-singular, emoji, classifier, classifierThai]]` feeds the endless `classifier` generator (Classifiers tile). Add new nouns there as classifiers come up.
  - `qa` = a real situation (emoji + English context) + an optional Thai question + a model answer. These are self-graded.
  - Card ids are derived from the romanization text, so editing a sentence's text resets its progress. Fix typos when needed, but don't churn.
- `app.js`: the app. `GENERATORS` makes random, endless items (time, duration, day, date, month, year, ordinal, meaning, classifier). A lesson turns a generator on by listing it in `generators`.
- Every card is multiple choice (the owner asked for no typing, 2026-11-15). Wrong options come from the same lesson first, then other lessons, so keep bracketed cloze targets varied within a lesson. Cloze cards always show the English meaning, so a distractor that fits grammatically is ruled out by the meaning. A generator item lists wrong answers in `distract` (best ones first) and `makeGen` turns it into options. `qa` answers containing "(example)" are open questions: the app shows them as think-then-compare cards, not options.
- `data/songs/index.json` lists song files in `data/songs/`. A song is a study page (not quiz cards): `id, title, artist, year, youtube` (video id), `lyricsUrl`, `about`, `lines[{r, th, en, note}]` (6-8 SHORT key excerpts only, in class romanization, Claude's own translations), `words[[rom, thai, english]]`, `notes[]`. Never store full lyrics. The owner sets line timestamps on their device (⏱ button).
- `sw.js`: network-first cache. Bump `CACHE` only if the cached shell needs a hard reset.

## Romanization (match the class exactly: Duke Language School, Journey 2)
- Vowels: aa ii uu ee oo (long = doubled), ɛ/ɛɛ, ɔ/ɔɔ, ʉ/ʉʉ, ə/əə; diphthongs ia, ʉa, ua; ai, ao.
- Consonants: g = ก, k = ข/ค, bp = ป, p = พ/ผ, dt = ต, t = ท/ถ, j = จ, ch = ช/ฉ, ng = ง.
- Tones: mid unmarked, low à, falling â, high á, rising ǎ (on the first vowel letter).
- Numbers are written as digits (8 moong 25 naatii).
- Follow the printed worksheets over handwriting. Hyphens and spaces are ignored by the answer checker.
- Spellings are checked against the book glossary (Journey 1–3 vocab pages, pp. 158–174). The glossary wins over Claude's guesses. Where the homework print differs (e.g. fítnèet vs glossary fítnèt), keep the homework form. Still unconfirmed: cháa-cháa, níu, too (โทร), jai-diao, kɔ́ɔt, rôm, tan, bao-wǎan, rót dtìt, and Claude-written noun spellings in 21-classifiers (gâo-îi, kúkgîi, jàkgrayaan, naalíkaa, gunjɛɛ, grà-dàat, nékktai, sɔ̂i kɔɔ, kěmkàt, tiiwii, rɔɔngtáao, dtàkiap), and Claude-written spellings from the board-photo lessons 27-30 that weren't on the boards (e.g. kéek, pítsâa, pǒnlamái, bɔɔrísàt, nákdtɔ̂ngtîao, oon ngən, bpanhǎa, wâaináam), and in lessons 31-34: ngûang, mamûang, nʉ́a, sâo, puugèt, Mʉang Booraan, wáttánátam-style words written by Claude. The owner said to leave unconfirmed words as they are unless a printed source shows otherwise.
- Book texts (interviews, milestone sentences) are copyrighted: write new sentences from their vocabulary instead of copying them.

## Rules for new content
- Use the homework sentences, and also write NEW varied sentences that recombine the vocabulary across lessons. The owner memorises worksheet answers, so the variety is the point.
- Use corrected answers (the teacher's red corrections), never the owner's mistakes.
- Keep personal details (names, school name, photos) out of this public repo.
- Thai script is needed for listening (device text-to-speech reads Thai script, not romanization).
- Writing/typing section: locked until the owner starts script lessons (Dec 2026). When it opens, only quiz words made of letters already taught.
- Songs: never store full copyrighted lyrics. Store title, artist, link, and cards for individual words and short phrases only.
