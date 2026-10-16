# Way In

Way In helps a middle school English teacher pick the next whole-class novel from the department's approved list, and keeps track of which students each pick leaves out.

- **Every student ranks the list.** Qloo scores each unread approved book against one student's interest survey (the shows, games, music and books they already like), and Way In compares that score with how the same book scores for the rest of the class. A book that fits this student better than it fits the class, and is among their top 3 such books, is their way in.
- **Students a book misses get a bridge clip.** For them, Way In takes the films Qloo says readers of that book also like, scores those films against the student's favorites, and keeps the films with the best combined place on both lists, within the class's allowed ratings and at most three films for the whole class. The teacher gets a film to pull a short scene from before chapter 1.
- **The term keeps a record.** For every unit, each student had a way in, a bridge clip, or nothing. Students who had nothing, or had something and didn't connect, count extra in the next pick (in the shortlist ranking, a way in counts 1 plus 0.5 for each earlier unit that student missed).

Live demo: **https://wayin.aii.ai.kr** (every visitor gets their own copy of a fictional 8th grade class; nothing to install, no login)

## The problem

In 2023, 14% of US 13-year-olds said they read for fun almost every day, down from 27% in 2012 (NAEP Long-Term Trend, NCES). Many middle school English classes still read a few whole-class novels each term, picked by the teacher from a department-approved list, and many teachers hand out an interest survey in the first weeks. Way In keeps a record of which students each pick leaves out.

How it works in the app:

1. **Read a survey.** The agent finds each title a student wrote ("Spider-Verse", "FC 24", "Olivia Rodrigo") in Qloo, asks the teacher when a title is ambiguous, and turns "not into scary movies" into the Qloo horror tag, which is then kept out of the bridge clips suggested to that student.
2. **Pick the next class read.** The agent ranks the unread books for every student, compares the strongest two or three books, searches bridge clips for the students each one leaves out, follows the teacher's note ("something with more humor after two serious books", "skip Refugee"), and picks the book that leaves the fewest students with nothing, counting students who missed earlier units extra. It states the numbers it compared. The plan opens with a "This week" box: which clips to queue and for whom, who needs a one-to-one check-in (with Qloo's best book for them outside the list as an independent-reading idea), and what to keep away from.
3. **Close the unit.** The teacher taps how each student took the book (hooked, kept up, didn't connect, absent). A book a student was hooked by becomes one of their favorites and a new Qloo signal; a student who didn't connect counts extra next time. The agent reads the teacher's note ("Lucas would rather read something like Ghost"), finds new favorites in Qloo, and writes a one-line note per student.

## How it uses Qloo

All calls are server-side `GET` requests to the hackathon API with the `X-Api-Key` header.

| Step | Endpoint and parameters | Why |
|---|---|---|
| Survey titles to entities | `/search` with `query` and `types` (`urn:entity:tv_show`, `movie`, `artist`, `videogame`, `book`, `person`) | Turn "FC 24" into an entity ID. Ambiguous matches go to the teacher. |
| Dislikes to tags | `/v2/tags` with `filter.query`, `filter.parents.types=urn:entity:movie,urn:entity:tv_show` | "Not into scary movies" becomes `urn:tag:genre:media:horror`. |
| Each student's ranking of the approved list | `/v2/insights` with `filter.type=urn:entity:book`, `signal.interests.entities` (that student's favorites), `filter.results.entities` (the approved books), `signal.demographics.age=24_and_younger`, `feature.explainability=true` | `filter.results.entities` restricts scoring to the list the teacher may choose from. Way In turns each score into a z-score within its book across the class, so a book counts for a student when it fits them better than it fits their classmates. Explainability says which favorite pulled the book up: "Ghost leads into Long Way Down". |
| Bridge clips | 1) `/v2/insights` with `filter.type=urn:entity:movie`, the book as the only signal, `filter.content_rating` (the class's allowed ratings; by default G and PG, plus TV-Y7 to TV-PG for TV films). 2) The same films with `filter.results.entities`, scored against each student's favorites, `filter.exclude.tags` for the student's dislikes, `feature.explainability=true` | Each student keeps up to five films by combined place on both lists, ordered by fit over the other students. A greedy cover then picks at most three films for the class. Before any of that, the book's films are checked for a 13-year-old class: no thriller, crime, horror, war or documentary genre (all of the film's genres are checked); a family, animation, adventure, fantasy, sci-fi, musical or sport genre, or a teen or family tag (whole tag names only, so "Family relationships" does not count); a romance only with a family genre or a teen tag; and a PG from before 1985 (before PG-13 existed) only if it is a family film. Titles without a rating, or with one outside the class's list, are dropped. The teacher can reject a clip ("Not this clip") and the student gets their next option; the class still keeps at most three films, so a student whose remaining options are all new films gets a one-to-one check-in instead. |
| Independent-reading idea | `/v2/insights` with `filter.type=urn:entity:book`, the student's favorites, the approved list in `filter.exclude.entities`, the student's dislikes in `filter.exclude.tags` | For students a pick leaves with nothing, and on each student's page. Only books Qloo tags for young readers (Middle Grade, Young Adult, 13-17), not Adult, and with none of the student's dislikes among their tags. |
| Opening day | Tags on the chosen book from the insights results, and the favorites that lead students into it | "Put Smile, Ghost and Ms. Marvel on the board: favorites in this class that lead into New Kid." |

Responses are cached on the server (the hackathon FAQ allows private caching; the cache is never committed). Requests are queued to stay under 5 per second, and the public demo has a daily budget of live calls so one visitor cannot use up the month. Per-address limits keep one visitor from blocking the others, and a class can run one agent job at a time.

### Why this needs Qloo

A language model will rank the list too, from its own sense of genres and authors. On the same five students, GPT-6.1 alone (favorites and the ten unread titles, nothing else) and Way In shared 7 of the 15 top-3 places:

| Student | Favorites | GPT-6.1 alone, top 3 | Way In (fit over the class, favorite behind it) |
|---|---|---|---|
| Nia | Pokemon Scarlet, Roblox, Ghost, Jason Reynolds | Long Way Down, The Crossover, Restart | Long Way Down (Ghost), Restart (Ghost), New Kid (Ghost) |
| Kenji | Hamilton, Akeelah and the Bee, Lin-Manuel Miranda, Brown Girl Dreaming | The Crossover, Long Way Down, Esperanza Rising | Long Way Down, Wonder, Esperanza Rising (all via Brown Girl Dreaming) |
| Zoe | Fortnite, MrBeast, Jumanji: Welcome to the Jungle, Diary of a Wimpy Kid | Holes, Restart, New Kid | Restart, The Crossover, Refugee (all via Diary of a Wimpy Kid) |
| Sofia | Stranger Things, Wednesday, Olivia Rodrigo, Smile | Long Way Down, Holes, A Wrinkle in Time | Esperanza Rising, Restart, New Kid (all via Smile) |
| Owen | Ms. Marvel, Coco, Karol G | New Kid, Esperanza Rising, The Crossover | New Kid (Ms. Marvel), A Wrinkle in Time (Coco), The Crossover (Ms. Marvel; below the class average, so not a way in) |

`npm run compare` builds this table against a running server, so the right column is what the app shows. Three model runs on 2026-10-16 shared 7, 6 and 7 places; the table shows the first. The overlap shows the two rankings differ, not which one suits a student better; neither has been tested with real students. What Qloo adds is a trace: Way In's picks come from what audiences of each favorite also like, compared with the rest of the class, and each names the favorite Qloo says carries the score. The bridge clips come from Qloo's audience for the book itself; a model has no list of what a book's readers watch.

### What the live data changed

Three things in the design come from running the demo class against the hackathon API:

- **Raw affinity is mostly shared.** Ranked by raw affinity, The Giver was in the top 3 for 15 of 17 students, Holes for 14 and The Crossover for 13, so a "way in" said little about the student. Scoring each book against the class average spread the top-3 places: each of the ten unread books is now in the top 3 of between 3 and 8 students, with lead-ins that make sense (Ghost leads Nia to Long Way Down, by the same author; Diary of a Wimpy Kid leads Zoe to Restart).
- **Explainability splits evenly when there are few inputs.** A first version picked clips that both the book and the student's favorites pushed up by explainability share. With the book and one favorite as inputs, most shares came back between 50/50 and 60/40 and 97% of results passed a 20% test, so it let weak picks through. The two-list method replaced it.
- **The book's audience includes adults.** For readers of these books, Qloo's TV results were mostly reality shows, so clips are films only, and the film list for New Kid was led by a PG papal thriller. That is why clips are checked by genre, tag and year as well as rating. The analysis compare endpoint returned no shared tags between game or TV favorites and a book in our test, so the opening uses the book's own tags and the favorites that lead into it.

## The agent

The agent runs on an Azure OpenAI deployment (GPT-6.1) through the Responses API with function tools:

- **Survey:** `search_qloo_entities`, `find_qloo_tags`, `save_profile`.
- **Pick:** `get_class`, `rank_texts`, `find_bridges` (per book), `look_at_book`, `choose_text` (with its reason), `submit_unit_plan`. The agent decides which books to compare, weighs the teacher's note, and must state the numbers it compared. Without the model, a fixed rule picks the book with the fewest students left with nothing; it only reads the teacher's note for books to skip and says so in the reason.
- **Close:** `search_qloo_entities`, `add_favorite`, `save_notes`.

Each run streams its steps and the exact Qloo requests to the page.

The server checks what the model hands back. Entity and tag IDs must have come from a Qloo response in the same run. A book can only be chosen after its bridges were checked. A way-in note can only go to a student who has a way in, and a bridge note must use the bridge Qloo returned for that student. A favorite added from a teacher note must quote at least 8 characters of the note. If the model fails or is switched off, the same Qloo pipeline runs with fixed rules and templates, and the page says so ("Picked with fixed rules"). If the model refuses calls (for example after its credit ends), the app stops trying for 30 minutes and shows "AI paused".

## Data handling

- Qloo receives entity IDs, tag IDs, an age bucket, content ratings and, as search text, the titles a student wrote. Every search is checked before it is sent: one that contains any classmate's first name, or a word like Mr. or Ms., is refused. In the no-model path, phrases next to family words ("my cousin Marco") and lone capitalized words that do not follow "like", "play", "watch" or similar are not searched either.
- The model receives first names, survey text and the teacher's notes. In the demo all of these are fictional. A real deployment would run inside the school's own Azure tenant under its student-privacy agreements (FERPA in the US).
- Qloo results describe group-level affinities. Way In treats them as suggestions for the teacher, shows ranks rather than percentages, and lets the teacher's own log of how students took a book feed back in.
- There are no fields for grades, behavior or health, and the agent is told to leave them out of notes. Survey text and teacher notes are stored as written, so teachers should keep such details out of them.

## Run it locally

Requires Node.js 22.6 or newer. There are no npm dependencies.

```sh
cp .env.example .env    # add a Qloo hackathon key and an Azure OpenAI deployment, or leave both empty
npm start               # http://localhost:8795
npm test                # 23 tests, mock Qloo data, AI off
npm run check           # tests the Qloo key and the model without printing either key
npm run compare         # the model-only table above, against the running server (live keys)
```

With no Qloo key, the app runs on a small built-in mock catalog (`server/qloo-mock.js`) with the same response shapes as the live API. Its titles, years and ratings are public facts; its scores are made up. With no Azure key, the agent steps run as fixed rules.

## Files

```
server/
  index.js        HTTP server, per-visitor workspaces, streaming runs, limits, security headers
  agent.js        survey, pick and close: tools, prompts, checks, rule fallbacks
  profiles.js     resolving favorites and the list, class rankings, bridge clips, outside picks
  planner.js      class-relative ranking, bridge selection, term record (no network)
  qloo.js         Qloo client: cache, rate limiter, daily budget, response normalizing
  qloo-mock.js    mock API for development and tests
  llm.js          Azure OpenAI Responses API: tool loop, structured output, model status
  store.js        per-visitor JSON workspaces
  config.js       environment settings
  demo-data.js    the fictional class
public/           the web app (no framework)
test/             node:test suites
scripts/check-setup.js   setup check
scripts/compare-model.js the model-only comparison
```

## Known limits

- "Way in" is a rank within the approved list, not a prediction that a student will like a book. With one book per unit, most students will not have that book in their top 3; that is why bridge clips and the term record exist.
- Way In does not look at reading level (Lexile), standards or content warnings. The approved list is assumed to cover those already, and the teacher still decides.
- Surveys name what students like today; some favorites are not in Qloo, and search can return near matches. The teacher confirms ambiguous titles.
- A bridge clip is a suggestion. Teachers preview it; the content rating filter is a floor, not a review.
- The class-relative ranking needs a class: with very few students the comparison is noisy.
- Searches that contain a classmate's first name are refused, so a title that is also a student's name ("Leo") cannot be added for that class.

## License

MIT, see [LICENSE](LICENSE).
