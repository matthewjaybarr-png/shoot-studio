// Preschool templates, the Preschool group of Create's templates: the forms, charts and posters a preschool teacher
// makes again and again (a daily report for parents, a sign-in sheet, schedule cards, a helpers chart, a lesson plan,
// attendance, an allergy poster, All about me, a permission slip, class rules, a welcome letter and a newsletter).
// Her class details from the Classroom drawer go straight in where they belong. Pictures are the app's clip art.
// Needs create.js, preschool.js (pic) and classroom.js (classroom).

// One of her class details, or what to show in its place while it's empty.
const classDetail = (key, otherwise) => (typeof classroom === 'function' && classroom()[key]) || otherwise;
const teacherName = () => classDetail('teacher', 'Teacher');
const PASTEL = { pink: ['#fde4ef', '#e7779f'], lilac: ['#ece4fb', '#9a86d6'], blue: ['#e1f0fd', '#6fa8dc'], mint: ['#e3f6ec', '#5bb88a'], yellow: ['#fff4d6', '#e0b84a'], peach: ['#ffe9dc', '#e89a6b'] };
// A soft rounded box in one of the pastels, with an optional heading at its top left (and a picture before it).
async function softBox(page, x, y, w, h, colour, heading, icon) {
  const [fill, edge] = PASTEL[colour];
  page.add(R(x, y, w, h, { rx: 18, ry: 18, fill, stroke: edge, strokeWidth: 2.5, kbName: (heading || 'Box') + ' box' }));
  if (icon) page.add(await pic(icon, x + 32, y + 30, 36));
  if (heading) page.add(T(heading, x + (icon ? 58 : 18), y + 12, { width: w - (icon ? 76 : 36), fontSize: 24, fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#3a3a3a', kbName: 'Heading' }));
}
const bigTitle = (text, top = 36, width = 720, left = 48, o = {}) => T(text, left, top, { width, fontSize: 52, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#7f63c9', kbName: 'Title', ...o });
const tickBox = (x, y, size = 22) => R(x, y, size, size, { rx: 4, ry: 4, stroke: '#555555', strokeWidth: 2, kbName: 'Tick box' });
const fillLine = (x, y, w) => new fabric.Line([x, y, x + w, y], { stroke: '#999999', strokeWidth: 1.5, kbName: 'Write here' });
// A grid of boxes with words in some: `cols` widths, `rows` heights, `text(r, c)` the words (or '' for none), `fill(r, c)`.
function gridBoxes(page, left, top, cols, rows, text, fill = () => 'transparent', o = {}) {
  let y = top;
  for (const [r, h] of rows.entries()) {
    let x = left;
    for (const [c, w] of cols.entries()) {
      page.add(R(x, y, w, h, { stroke: '#8f8f8f', strokeWidth: 1.5, fill: fill(r, c), kbName: 'Table cell' }));
      const words = text(r, c);
      if (words) page.add(T(words, x + 6, y + Math.max(4, h / 2 - (o.size || 18) * 0.65), { width: w - 12, minWidth: 1, fontSize: o.size || 18, textAlign: o.align?.(r, c) || 'left', fontFamily: r === 0 ? 'Fredoka' : 'Lexend', fontWeight: r === 0 ? 'bold' : 'normal', kbName: 'Cell text' }));
      x += w;
    }
    y += h;
  }
}
// Cards in a grid, each with a picture and words under it (and `extra` for anything more on a card).
async function pictureCards(page, cards, cols, top, cardH, colours, extra) {
  const gap = 16, w = (720 - gap * (cols - 1)) / cols;
  for (const [i, [icon, words]] of cards.entries()) {
    const x = 48 + (i % cols) * (w + gap), y = top + Math.floor(i / cols) * (cardH + gap), [fill, edge] = PASTEL[colours[i % colours.length]];
    page.add(R(x, y, w, cardH, { rx: 18, ry: 18, fill, stroke: edge, strokeWidth: 2.5, kbName: 'Card' }), await pic(icon, x + w / 2, y + cardH * 0.36, cardH * 0.42),
      T(words, x + 8, y + cardH * 0.64, { width: w - 16, fontSize: 24, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Card words' }));
    extra?.(x, y, w, cardH);
  }
}

Object.assign(STARTERS, {
  'Daily report': async page => {
    page.add(bigTitle('My Day at School', 30), T(classDetail('klass', 'Class') + ' · ' + teacherName(), 48, 98, { width: 720, fontSize: 20, textAlign: 'center', fill: '#777777', kbName: 'Class' }),
      T('Name: ____________________   Date: ____________', 48, 134, { width: 720, fontSize: 22, textAlign: 'center', kbName: 'Name line' }));
    await softBox(page, 48, 178, 720, 214, 'peach', 'I ate', 'fork and knife with plate');
    gridBoxes(page, 70, 222, [196, 120, 120, 120, 120], [34, 34, 34, 34, 34], (r, c) => r === 0 ? ['', 'All', 'Most', 'Some', 'None'][c] : c === 0 ? ['', 'Breakfast', 'Morning snack', 'Lunch', 'Afternoon snack'][r] : '', () => '#ffffff', { align: (r, c) => c ? 'center' : 'left' });
    await softBox(page, 48, 406, 352, 150, 'blue', 'I slept', 'sleeping face');
    page.add(T('From', 70, 460, { width: 80, fontSize: 20 }), fillLine(130, 484, 100), T('to', 240, 460, { width: 40, fontSize: 20 }), fillLine(270, 484, 100),
      T('From', 70, 508, { width: 80, fontSize: 20 }), fillLine(130, 532, 100), T('to', 240, 508, { width: 40, fontSize: 20 }), fillLine(270, 532, 100));
    await softBox(page, 416, 406, 352, 150, 'mint', 'Diapers and potty', 'toilet');
    gridBoxes(page, 432, 448, [84, 76, 76, 84], [26, 26, 26, 26], (r, c) => r === 0 ? ['Time', 'Wet', 'BM', 'Potty'][c] : '', () => '#ffffff', { size: 15, align: () => 'center' });
    await softBox(page, 48, 570, 720, 150, 'yellow', 'Today I was');
    for (const [i, [face, word]] of [['grinning face', 'Happy'], ['slightly smiling face', 'Calm'], ['sleepy face', 'Tired'], ['crying face', 'Sad']].entries()) {
      const cx = 138 + i * 180;
      page.add(await pic(face, cx, 650, 56), T(word, cx - 60, 682, { width: 120, fontSize: 20, textAlign: 'center', fontFamily: 'Fredoka', kbName: 'Mood' }));
    }
    await softBox(page, 48, 734, 720, 100, 'lilac', 'Please bring');
    for (const [i, word] of ['Diapers', 'Wipes', 'Clothes', 'Cream', 'Other'].entries()) page.add(tickBox(72 + i * 140, 788), T(word, 102 + i * 140, 786, { width: 104, fontSize: 20, kbName: 'Item' }));
    await softBox(page, 48, 848, 720, 168, 'pink', 'Notes');
    for (let i = 0; i < 3; i++) page.add(fillLine(70, 920 + i * 34, 676));
  },
  'Sign-in sheet': async page => {
    page.add(bigTitle('Sign In and Sign Out', 30), T(classDetail('klass', 'Class') + ' · ' + teacherName() + '        Week of: ______________', 48, 102, { width: 720, fontSize: 20, textAlign: 'center', kbName: 'Class' }));
    gridBoxes(page, 48, 150, [200, 96, 172, 96, 156], [40, ...Array(17).fill(49)], (r, c) => r === 0 ? ["Child's name", 'Time in', 'Signature', 'Time out', 'Signature'][c] : '', r => r === 0 ? PASTEL.lilac[0] : 'transparent');
  },
  'Visual schedule': async page => {
    page.add(bigTitle('Our Day', 24), T('Cut out the cards and put them up in the order of your day.', 48, 92, { width: 720, fontSize: 18, textAlign: 'center', fill: '#777777', kbName: 'Instructions' }));
    await pictureCards(page, [['waving hand', 'Hello'], ['books', 'Circle time'], ['artist palette', 'Art'], ['red apple', 'Snack'], ['soap', 'Wash hands'], ['sun', 'Outside'], ['toilet', 'Bathroom'], ['fork and knife with plate', 'Lunch'], ['sleeping face', 'Nap'], ['open book', 'Story'], ['musical notes', 'Music'], ['house', 'Home time']],
      3, 130, 214, ['pink', 'lilac', 'blue', 'mint', 'yellow', 'peach']);
  },
  'Class helpers': async page => {
    page.add(bigTitle('Our Class Helpers', 24), T(classDetail('klass', ''), 48, 92, { width: 720, fontSize: 20, textAlign: 'center', fill: '#777777', kbName: 'Class' }));
    await pictureCards(page, [['footprints', 'Line leader'], ['door', 'Door holder'], ['spiral calendar', 'Calendar'], ['sun behind cloud', 'Weather'], ['red apple', 'Snack helper'], ['potted plant', 'Plant waterer'], ['light bulb', 'Lights'], ['broom', 'Clean-up'], ['envelope', 'Messenger'], ['books', 'Book helper'], ['bell', 'Quiet bell'], ['star', 'Star helper']],
      3, 130, 214, ['mint', 'yellow', 'pink', 'blue', 'peach', 'lilac'], (x, y, w, h) => page.add(T('Name', x + 8, y + h - 44, { width: w - 16, fontSize: 24, textAlign: 'center', fontFamily: 'Caveat', fill: '#555555', kbName: 'Helper name' })));
  },
  'Weekly lesson plan': async page => {
    page.add(bigTitle('Weekly Plan', 20, 976, 40, { fontSize: 44 }),
      T('Theme: ____________________   Week of: ______________   ' + teacherName() + (classDetail('klass', '') ? ' · ' + classDetail('klass', '') : ''), 40, 78, { width: 976, fontSize: 18, textAlign: 'center', kbName: 'Theme line' }));
    const rows = ['', 'Circle time', 'Letters', 'Numbers', 'Art', 'Science and sensory', 'Music and movement', 'Outside', 'Notes'];
    gridBoxes(page, 40, 114, [146, 166, 166, 166, 166, 166], [36, ...Array(8).fill(81)], (r, c) => r === 0 ? ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][c] : c === 0 ? rows[r] : '', (r, c) => r === 0 || c === 0 ? PASTEL[['pink', 'lilac', 'blue', 'mint', 'yellow', 'peach', 'pink', 'lilac', 'blue'][r]][0] : 'transparent', { size: 16, align: (r, c) => r === 0 ? 'center' : 'left' });
  },
  'Monthly attendance': async page => {
    page.add(bigTitle('Attendance', 18, 976, 40, { fontSize: 40 }), T('Month: ______________   ' + classDetail('klass', 'Class') + ' · ' + teacherName(), 40, 70, { width: 976, fontSize: 18, textAlign: 'center', kbName: 'Month line' }));
    const day = 24.5, cols = [216, ...Array(31).fill(day)];
    gridBoxes(page, 40, 104, cols, [30, ...Array(21).fill(30)], (r, c) => r === 0 ? (c ? String(c) : 'Name') : '', r => r === 0 ? PASTEL.blue[0] : r % 2 ? 'transparent' : '#f7f4fd', { size: 12, align: (r, c) => c ? 'center' : 'left' });
    page.add(T('✓ here    A absent    T tardy', 40, 772, { width: 976, fontSize: 14, fill: '#777777', kbName: 'Key' }));
  },
  'Allergy alert': async page => {
    page.add(R(0, 0, 816, 120, { fill: '#fde0e0', stroke: '#fde0e0', kbName: 'Band' }), await pic('warning', 92, 60, 70),
      T('Allergy Alert', 140, 26, { width: 536, fontSize: 56, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#c62828', kbName: 'Title' }), await pic('warning', 724, 60, 70));
    for (let i = 0; i < 6; i++) {
      const y = 140 + i * 140;
      page.add(R(48, y, 720, 128, { rx: 16, ry: 16, stroke: '#e57373', strokeWidth: 2.5, kbName: 'Child box' }), makeFrame(104, 104, 'circle', { left: 62, top: y + 12 }),
        T('Name', 192, y + 14, { width: 260, fontSize: 30, fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Child name' }),
        T('Allergic to: ________________', 192, y + 54, { width: 560, fontSize: 20, kbName: 'Allergy' }), T('If exposed: ____________________________', 192, y + 88, { width: 560, fontSize: 20, kbName: 'What to do' }));
    }
    page.add(T(classDetail('klass', 'Class') + ' · ' + teacherName(), 48, 1056 - 50, { width: 720, fontSize: 18, textAlign: 'center', fill: '#777777', kbName: 'Class' }));
  },
  'All about me': async page => {
    page.add(bigTitle('All About Me', 28, 720, 48, { fill: '#e7779f' }), makeFrame(300, 300, 'rounded', { left: 48, top: 112 }));
    page.add(T('My name is', 372, 120, { width: 396, fontSize: 24, fontFamily: 'Fredoka', kbName: 'Prompt' }), fillLine(372, 190, 396),
      T('I am        years old', 372, 214, { width: 300, fontSize: 24, fontFamily: 'Fredoka', kbName: 'Prompt' }), await pic('birthday cake', 720, 230, 56),
      T('My birthday is', 372, 290, { width: 396, fontSize: 24, fontFamily: 'Fredoka', kbName: 'Prompt' }), fillLine(372, 360, 396));
    const favs = [['artist palette', 'My favourite colour', 'pink'], ['red apple', 'My favourite food', 'mint'], ['dog face', 'My favourite animal', 'blue'], ['teddy bear', 'My favourite toy', 'yellow']];
    for (const [i, [icon, words, colour]] of favs.entries()) {
      const x = 48 + (i % 2) * 368, y = 436 + Math.floor(i / 2) * 196;
      await softBox(page, x, y, 352, 180, colour, words, icon);
    }
    await softBox(page, 48, 832, 720, 184, 'lilac', 'When I grow up, I want to be', 'sparkles');
  },
  'Permission slip': async page => {
    for (const top of [0, 528]) {
      page.add(T('Field Trip Permission Slip', 48, top + 30, { width: 720, fontSize: 34, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#7f63c9', kbName: 'Title' }),
        T('Where: ______________________   When: ______________', 64, top + 92, { width: 688, fontSize: 20, kbName: 'Where' }),
        T('Leaving: ________   Back: ________   Cost: ________', 64, top + 132, { width: 688, fontSize: 20, kbName: 'Times' }),
        T('Please bring: ______________________________________', 64, top + 172, { width: 688, fontSize: 20, kbName: 'Bring' }),
        T('I give permission for my child ______________________ to go on this trip.', 64, top + 232, { width: 688, fontSize: 20, kbName: 'Permission' }),
        T('Parent signature: ______________________   Date: __________', 64, top + 292, { width: 688, fontSize: 20, kbName: 'Signature' }),
        T('Phone on the day: ______________________', 64, top + 340, { width: 688, fontSize: 20, kbName: 'Phone' }),
        tickBox(64, top + 392), T('I can help as a chaperone.', 96, top + 390, { width: 400, fontSize: 20, kbName: 'Chaperone' }),
        T('Please return by ____________ to ' + teacherName() + '.', 64, top + 440, { width: 688, fontSize: 18, fill: '#777777', kbName: 'Return to' }));
    }
    page.add(new fabric.Line([24, 528, 792, 528], { stroke: '#999999', strokeWidth: 2, strokeDashArray: [10, 8], kbName: 'Cut here' }), await pic('scissors', 40, 528, 28));
  },
  'Class rules': async page => {
    page.add(bigTitle('Our Class Rules', 40, 720, 48, { fontSize: 64 }));
    const rules = [['ear', 'We listen'], ['raised hand', 'We raise our hand'], ['footprints', 'We use walking feet'], ['open hands', 'We use gentle hands'], ['speech balloon', 'We use kind words'], ['broom', 'We clean up together']];
    const colours = ['pink', 'lilac', 'blue', 'mint', 'yellow', 'peach'];
    for (const [i, [icon, words]] of rules.entries()) {
      const y = 150 + i * 145, [fill, edge] = PASTEL[colours[i]];
      page.add(R(48, y, 720, 128, { rx: 64, ry: 64, fill, stroke: edge, strokeWidth: 3, kbName: 'Rule' }), await pic(icon, 128, y + 64, 92),
        T(words, 200, y + 36, { width: 540, fontSize: 44, fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#3a3a3a', kbName: 'Rule words' }));
    }
  },
  'Welcome letter': async page => {
    page.add(R(0, 0, 816, 150, { fill: PASTEL.lilac[0], stroke: PASTEL.lilac[0], kbName: 'Band' }),
      T('Welcome to ' + classDetail('klass', 'our class') + '!', 48, 34, { width: 560, fontSize: 40, fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#7f63c9', kbName: 'Title' }),
      T([classDetail('school', 'School'), classDetail('room', ''), classDetail('year', '')].filter(Boolean).join(' · '), 48, 96, { width: 560, fontSize: 20, fill: '#555555', kbName: 'School' }),
      makeFrame(150, 150, 'circle', { left: 630, top: 60 }),
      T('Dear Families,', 48, 236, { width: 720, fontSize: 26, fontFamily: 'Caveat', kbName: 'Greeting' }),
      T("I'm so happy to welcome your child to our class this year! A little about me:", 48, 290, { width: 720, fontSize: 20, kbName: 'Paragraph' }),
      T('Write about yourself here.', 48, 350, { width: 720, fontSize: 20, fill: '#777777', kbName: 'Paragraph' }),
      T('Our day is full of play, songs, stories and learning together.', 48, 430, { width: 720, fontSize: 20, kbName: 'Paragraph' }));
    await softBox(page, 48, 500, 352, 260, 'pink', 'Please bring', 'backpack');
    for (const [i, item] of ['A change of clothes', 'A water bottle', 'A blanket for nap', 'A family photo'].entries()) page.add(tickBox(72, 556 + i * 46), T(item, 104, 554 + i * 46, { width: 280, fontSize: 20, kbName: 'Item' }));
    await softBox(page, 416, 500, 352, 260, 'blue', 'Get in touch', 'envelope');
    page.add(T('Email: ________________\nPhone: ________________\nBest time: ______________', 436, 556, { width: 316, fontSize: 20, lineHeight: 1.6, kbName: 'Contact' }));
    page.add(T("I can't wait for a wonderful year!", 48, 800, { width: 720, fontSize: 22, kbName: 'Paragraph' }),
      T('Warmly,', 48, 860, { width: 300, fontSize: 22, kbName: 'Sign-off' }), T(teacherName(), 48, 900, { width: 400, fontSize: 40, fontFamily: 'Caveat', kbName: 'Teacher' }));
  },
  'Our week newsletter': async page => {
    page.add(bigTitle('Our Week', 24, 720, 48, { fontSize: 56 }), T(classDetail('klass', 'Class') + ' · ' + teacherName() + ' · Week of ________', 48, 98, { width: 720, fontSize: 20, textAlign: 'center', fill: '#777777', kbName: 'Class' }));
    await softBox(page, 48, 146, 720, 230, 'lilac', 'This week we learned about', 'open book');
    page.add(T('Write about your week here.', 70, 200, { width: 676, fontSize: 20, fill: '#777777', kbName: 'Paragraph' }));
    const weekly = [['Letter of the week', 'pink', 'Aa'], ['Number of the week', 'blue', '5'], ['Colour of the week', 'yellow', 'Red'], ['Shape of the week', 'mint', '●']];
    for (const [i, [words, colour, sample]] of weekly.entries()) {
      const x = 48 + i * 184;
      await softBox(page, x, 392, 168, 196, colour);
      page.add(T(words, x + 8, 402, { width: 152, fontSize: 18, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Heading' }),
        T(sample, x + 8, 470, { width: 152, fontSize: 60, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: PASTEL[colour][1], kbName: 'Of the week' }));
    }
    await softBox(page, 48, 604, 352, 412, 'peach', 'Reminders', 'bell');
    await softBox(page, 416, 604, 352, 412, 'mint', 'Coming up', 'spiral calendar');
    for (let i = 0; i < 6; i++) page.add(T('•', 70, 662 + i * 56, { width: 20, fontSize: 22, kbName: 'Bullet' }), fillLine(92, 686 + i * 56, 288), T('•', 438, 662 + i * 56, { width: 20, fontSize: 22, kbName: 'Bullet' }), fillLine(460, 686 + i * 56, 288));
  }
});
Object.assign(STARTER_PAGE, { 'Weekly lesson plan': 'letter-landscape', 'Monthly attendance': 'letter-landscape' });
for (const name of ['Daily report', 'Sign-in sheet', 'Visual schedule', 'Class helpers', 'Weekly lesson plan', 'Monthly attendance', 'Allergy alert', 'All about me', 'Permission slip', 'Class rules', 'Welcome letter', 'Our week newsletter']) STARTER_GROUP[name] = 'Preschool';
