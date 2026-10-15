// The demo class. Every student here is fictional. Favorites are written the way an 8th grade
// interest survey usually comes back: a show, a movie, a singer, a game, a book. Seeds start
// unresolved ({ name, type }); the app looks them up in Qloo the first time and keeps the IDs.

const DAY = 24 * 3600 * 1000;

const S = (id, first_name, last_initial, favorites, extra = {}) => ({ id, first_name, last_initial, favorites, ...extra });

const STUDENTS = [
  S('s_maya', 'Maya', 'R', [['NBA 2K24', 'videogame'], ['Cobra Kai', 'tv_show'], ['Remember the Titans', 'movie']]),
  S('s_jonah', 'Jonah', 'K', [['Encanto', 'movie'], ['Taylor Swift', 'artist'], ['Heartstopper', 'book']]),
  S('s_amara', 'Amara', 'O', [['Minecraft', 'videogame'], ['Alone', 'tv_show'], ['The Martian', 'movie'], ['The Maze Runner', 'book']]),
  S('s_lucas', 'Lucas', 'P', [['One Piece', 'tv_show'], ['Naruto', 'tv_show'], ['Hollow Knight', 'videogame']]),
  S('s_sofia', 'Sofia', 'G', [['Stranger Things', 'tv_show'], ['Wednesday', 'tv_show'], ['Olivia Rodrigo', 'artist'], ['Smile', 'book']]),
  S('s_kenji', 'Kenji', 'T', [['Hamilton', 'movie'], ['Akeelah and the Bee', 'movie'], ['Lin-Manuel Miranda', 'artist'], ['Brown Girl Dreaming', 'book']]),
  S('s_priya', 'Priya', 'S', [['The Mandalorian', 'tv_show'], ['Dune', 'movie'], ['Ready Player One', 'movie'], ['The Hunger Games', 'book']]),
  S('s_ethan', 'Ethan', 'W', [['BTS', 'artist'], ['Spirited Away', 'movie'], ['Animal Crossing: New Horizons', 'videogame']], {
    avoid_note: 'Nothing gory or scary, please.',
    avoid: [{ label: 'horror', query: 'horror', reason: 'Survey: "nothing gory or scary"' }],
  }),
  S('s_zoe', 'Zoe', 'L', [['Fortnite', 'videogame'], ['MrBeast', 'person'], ['Jumanji: Welcome to the Jungle', 'movie'], ['Diary of a Wimpy Kid', 'book']]),
  S('s_malik', 'Malik', 'J', [['Gravity Falls', 'tv_show'], ['Wednesday', 'tv_show'], ['Knives Out', 'movie']]),
  S('s_hana', 'Hana', 'K', [['Abbott Elementary', 'tv_show'], ['Black Panther', 'movie'], ['Beyoncé', 'artist'], ['Amari and the Night Brothers', 'book']]),
  S('s_owen', 'Owen', 'B', [['Ms. Marvel', 'tv_show'], ['Coco', 'movie'], ['Karol G', 'artist']]),
  S('s_isabella', 'Isabella', 'C', [['Never Have I Ever', 'tv_show'], ['Enola Holmes', 'movie'], ['Taylor Swift', 'artist'], ['Wings of Fire', 'book']]),
  S('s_aiden', 'Aiden', 'F', [['Avatar: The Last Airbender', 'tv_show'], ['The Legend of Zelda: Tears of the Kingdom', 'videogame'], ['The Lightning Thief', 'book'], ['Nimona', 'movie']]),
  S('s_grace', 'Grace', 'H', [["Five Nights at Freddy's", 'videogame'], ['Stranger Things', 'tv_show'], ['Coraline', 'movie']]),
  S('s_leo', 'Leo', 'V', [['Hidden Figures', 'movie'], ['The Wild Robot', 'movie'], ['Stardew Valley', 'videogame']]),
  S('s_nia', 'Nia', 'A', [['Pokémon Scarlet and Violet', 'videogame'], ['Roblox', 'videogame'], ['Ghost', 'book'], ['Jason Reynolds', 'person']]),
  // Transferred in this week: only the survey answer. The demo starts here.
  S('s_diego', 'Diego', 'M', [], {
    new_student: true,
    survey_text:
      'I like Spider-Verse a lot and Olivia Rodrigo. I play FC 24 with my cousins every weekend. The Wild Robot was the last movie I really liked. Not into scary movies.',
  }),
];

// The department's approved list for 8th grade English. The class reads one per unit.
const SHORTLIST = [
  ['The Outsiders', 'S. E. Hinton'],
  ['Hatchet', 'Gary Paulsen'],
  ['The Giver', 'Lois Lowry'],
  ['Wonder', 'R. J. Palacio'],
  ['Esperanza Rising', 'Pam Muñoz Ryan'],
  ['Long Way Down', 'Jason Reynolds'],
  ['A Wrinkle in Time', "Madeleine L'Engle"],
  ['Refugee', 'Alan Gratz'],
  ['New Kid', 'Jerry Craft'],
  ['The Crossover', 'Kwame Alexander'],
  ['Holes', 'Louis Sachar'],
  ['The Last Cuentista', 'Donna Barba Higuera'],
];

const TYPE_LABEL = { tv_show: 'Show', movie: 'Movie', artist: 'Music', videogame: 'Game', book: 'Book', person: 'Follows' };

function surveyText(st) {
  if (st.survey_text) return st.survey_text;
  const parts = st.favorites.map(([name, type]) => `${TYPE_LABEL[type]}: ${name}`);
  if (st.avoid_note) parts.push(`Not for me: ${st.avoid_note}`);
  return parts.join(' · ');
}

// The first two units were picked the usual way, before Way In. When a workspace is created the
// app looks back at them with Qloo to show who had a way in.
function pastUnit(id, title, book, startDaysAgo, endDaysAgo, now) {
  return {
    id,
    title,
    text_name: book,
    start: new Date(now.getTime() - startDaysAgo * DAY).toISOString(),
    end: new Date(now.getTime() - endDaysAgo * DAY).toISOString(),
    status: 'done',
    picked_by: 'teacher',
    plan: null,
    reactions: {},
    seed_from_demo: true,
  };
}

export function demoClass(now) {
  return {
    klass: {
      name: 'Period 3 · English 8',
      school: 'Riverside Middle School (demo)',
      grade: 8,
      term: 'Fall term',
      fictional: true,
      // Clip ratings allowed for bridges in this class (filter.content_rating).
      ratings: ['G', 'PG', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG'],
    },
    students: STUDENTS.map((st) => ({
      id: st.id,
      first_name: st.first_name,
      last_initial: st.last_initial,
      survey: surveyText(st),
      seeds: st.favorites.map(([name, type]) => ({ name, type, source: 'survey', status: 'unresolved' })),
      avoid: structuredClone(st.avoid || []),
      excluded: [],
      history: [],
      new_student: Boolean(st.new_student),
    })),
    shortlist: SHORTLIST.map(([name, author]) => ({ name, author, status: 'unresolved' })),
    units: [pastUnit('u_1', 'Unit 1: Surviving alone', 'Hatchet', 52, 27, now), pastUnit('u_2', 'Unit 2: Perfect worlds', 'The Giver', 24, 1, now)],
  };
}
