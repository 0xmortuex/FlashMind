// ===== Demo Deck =====
// A bundled study set so a first-time visitor can see FlashMind's output
// instantly, with zero API calls. Two languages; picked by current UI lang.
const Demo = (() => {
  const EN = {
    title: 'Photosynthesis (Demo)',
    notes: {
      summary: 'Photosynthesis is how plants, algae, and some bacteria convert light energy into chemical energy stored as glucose, releasing oxygen as a by-product.',
      sections: [
        {
          title: 'The Core Reaction',
          content: 'Light energy drives the conversion of carbon dioxide and water into glucose and oxygen. It happens in the chloroplasts, mainly in the leaves.',
          keyTerms: [
            { term: 'Chlorophyll', definition: 'The green pigment that absorbs light, mostly red and blue wavelengths.' },
            { term: 'Chloroplast', definition: 'The organelle where photosynthesis takes place.' },
            { term: 'Stomata', definition: 'Pores on the leaf that let CO2 in and O2 out.' }
          ],
          bulletPoints: [
            'Overall equation: 6CO2 + 6H2O + light -> C6H12O6 + 6O2',
            'Two stages: light-dependent reactions and the Calvin cycle.',
            'Oxygen comes from splitting water, not from carbon dioxide.'
          ]
        },
        {
          title: 'Light-Dependent vs Light-Independent',
          content: 'The light-dependent reactions capture energy in the thylakoid membranes. The Calvin cycle then uses that energy to build glucose in the stroma.',
          keyTerms: [
            { term: 'ATP', definition: 'Energy currency produced in the light reactions.' },
            { term: 'Calvin cycle', definition: 'Light-independent reactions that fix carbon into glucose.' }
          ],
          bulletPoints: [
            'Light reactions need light directly; the Calvin cycle does not.',
            'The Calvin cycle uses ATP and NADPH from the light reactions.'
          ]
        }
      ],
      importantDates: [],
      commonMistakes: [
        'Thinking oxygen comes from CO2 — it actually comes from water.',
        'Confusing respiration with photosynthesis; they are opposite processes.'
      ],
      diagrams: []
    },
    flashcards: [
      { id: 1, front: 'What gas do plants release during photosynthesis?', back: 'Oxygen', difficulty: 'easy', category: 'Basics' },
      { id: 2, front: 'Where does photosynthesis occur?', back: 'In the chloroplasts, mainly in leaf cells', difficulty: 'easy', category: 'Basics' },
      { id: 3, front: 'What pigment absorbs light for photosynthesis?', back: 'Chlorophyll', difficulty: 'easy', category: 'Basics' },
      { id: 4, front: 'Name the two main stages of photosynthesis.', back: 'Light-dependent reactions and the Calvin cycle', difficulty: 'medium', category: 'Process' },
      { id: 5, front: 'Where does the oxygen released actually come from?', back: 'From splitting water molecules (photolysis)', difficulty: 'medium', category: 'Process' },
      { id: 6, front: 'What two products of the light reactions power the Calvin cycle?', back: 'ATP and NADPH', difficulty: 'hard', category: 'Process' },
      { id: 7, front: 'Write the overall equation for photosynthesis.', back: '6CO2 + 6H2O + light -> C6H12O6 + 6O2', difficulty: 'hard', category: 'Chemistry' }
    ],
    quiz: [
      { id: 1, type: 'multiple-choice', question: 'Which of the following is a product of photosynthesis?', options: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Methane', 'Hydrogen'], correct: 1, explanation: 'Photosynthesis produces glucose and releases oxygen.' },
      { id: 2, type: 'true-false', question: 'The oxygen released in photosynthesis comes from carbon dioxide.', correct: false, explanation: 'It comes from the splitting of water molecules.' },
      { id: 3, type: 'fill-blank', question: 'The green pigment that absorbs light is called ___.', answers: ['chlorophyll'], explanation: 'Chlorophyll absorbs mainly red and blue light.' },
      { id: 4, type: 'matching', question: 'Match each term to its role.', pairs: [
        { left: 'Chloroplast', right: 'Site of photosynthesis' },
        { left: 'Stomata', right: 'Gas exchange pores' },
        { left: 'ATP', right: 'Energy carrier' }
      ], explanation: 'Each structure has a distinct role in the process.' },
      { id: 5, type: 'open-ended', question: 'Explain the difference between the light-dependent reactions and the Calvin cycle.', correctAnswer: 'Light-dependent reactions capture light energy in the thylakoids to make ATP and NADPH; the Calvin cycle uses those in the stroma to fix CO2 into glucose and does not need light directly.', keyPoints: ['Light reactions capture energy / make ATP & NADPH', 'Calvin cycle fixes carbon into glucose', 'Calvin cycle does not need light directly'], maxPoints: 3, explanation: '' }
    ]
  };

  const TR = {
    title: 'Fotosentez (Demo)',
    notes: {
      summary: 'Fotosentez; bitkilerin, alglerin ve bazi bakterilerin isik enerjisini glikozda depolanan kimyasal enerjiye cevirmesi ve yan urun olarak oksijen aciga cikarmasidir.',
      sections: [
        {
          title: 'Temel Tepkime',
          content: 'Isik enerjisi, karbondioksit ve suyun glikoz ve oksijene donusmesini saglar. Bu olay kloroplastlarda, cogunlukla yapraklarda gerceklesir.',
          keyTerms: [
            { term: 'Klorofil', definition: 'Isigi (cogunlukla kirmizi ve mavi) soguran yesil pigment.' },
            { term: 'Kloroplast', definition: 'Fotosentezin gerceklestigi organel.' },
            { term: 'Stoma', definition: 'Yaprakta CO2 girisi ve O2 cikisini saglayan gozenekler.' }
          ],
          bulletPoints: [
            'Genel denklem: 6CO2 + 6H2O + isik -> C6H12O6 + 6O2',
            'Iki asama: isiga bagli tepkimeler ve Calvin dongusu.',
            'Oksijen, karbondioksitten degil suyun parcalanmasindan gelir.'
          ]
        },
        {
          title: 'Isiga Bagli ve Isiktan Bagimsiz Tepkimeler',
          content: 'Isiga bagli tepkimeler tilakoid zarlarda enerji yakalar. Calvin dongusu ise bu enerjiyi kullanarak stromada glikoz uretir.',
          keyTerms: [
            { term: 'ATP', definition: 'Isik tepkimelerinde uretilen enerji birimi.' },
            { term: 'Calvin dongusu', definition: 'Karbonu glikoza baglayan isiktan bagimsiz tepkimeler.' }
          ],
          bulletPoints: [
            'Isik tepkimeleri dogrudan isik ister; Calvin dongusu istemez.',
            'Calvin dongusu, isik tepkimelerinden gelen ATP ve NADPH kullanir.'
          ]
        }
      ],
      importantDates: [],
      commonMistakes: [
        'Oksijenin CO2 den geldigini sanmak — aslinda sudan gelir.',
        'Solunum ile fotosentezi karistirmak; bunlar zit sureclerdir.'
      ],
      diagrams: []
    },
    flashcards: [
      { id: 1, front: 'Bitkiler fotosentezde hangi gazi aciga cikarir?', back: 'Oksijen', difficulty: 'easy', category: 'Temel' },
      { id: 2, front: 'Fotosentez nerede gerceklesir?', back: 'Kloroplastlarda, cogunlukla yaprak hucrelerinde', difficulty: 'easy', category: 'Temel' },
      { id: 3, front: 'Fotosentez icin isigi hangi pigment sogurur?', back: 'Klorofil', difficulty: 'easy', category: 'Temel' },
      { id: 4, front: 'Fotosentezin iki ana asamasini soyleyin.', back: 'Isiga bagli tepkimeler ve Calvin dongusu', difficulty: 'medium', category: 'Surec' },
      { id: 5, front: 'Aciga cikan oksijen gercekte nereden gelir?', back: 'Su molekullerinin parcalanmasindan (fotoliz)', difficulty: 'medium', category: 'Surec' },
      { id: 6, front: 'Isik tepkimelerinin hangi iki urunu Calvin dongusunu calistirir?', back: 'ATP ve NADPH', difficulty: 'hard', category: 'Surec' },
      { id: 7, front: 'Fotosentezin genel denklemini yazin.', back: '6CO2 + 6H2O + isik -> C6H12O6 + 6O2', difficulty: 'hard', category: 'Kimya' }
    ],
    quiz: [
      { id: 1, type: 'multiple-choice', question: 'Asagidakilerden hangisi fotosentezin bir urunudur?', options: ['Karbondioksit', 'Oksijen', 'Azot', 'Metan', 'Hidrojen'], correct: 1, explanation: 'Fotosentez glikoz uretir ve oksijen aciga cikarir.' },
      { id: 2, type: 'true-false', question: 'Fotosentezde aciga cikan oksijen karbondioksitten gelir.', correct: false, explanation: 'Oksijen, su molekullerinin parcalanmasindan gelir.' },
      { id: 3, type: 'fill-blank', question: 'Isigi soguran yesil pigmentin adi ___ dir.', answers: ['klorofil'], explanation: 'Klorofil cogunlukla kirmizi ve mavi isigi sogurar.' },
      { id: 4, type: 'matching', question: 'Her terimi gorevine eslestirin.', pairs: [
        { left: 'Kloroplast', right: 'Fotosentez yeri' },
        { left: 'Stoma', right: 'Gaz alisverisi gozenekleri' },
        { left: 'ATP', right: 'Enerji tasiyicisi' }
      ], explanation: 'Her yapinin surecte ayri bir gorevi vardir.' },
      { id: 5, type: 'open-ended', question: 'Isiga bagli tepkimeler ile Calvin dongusu arasindaki farki aciklayin.', correctAnswer: 'Isiga bagli tepkimeler tilakoitlerde isik enerjisini yakalayarak ATP ve NADPH uretir; Calvin dongusu bunlari stromada kullanarak CO2 yi glikoza baglar ve dogrudan isiga ihtiyac duymaz.', keyPoints: ['Isik tepkimeleri enerji yakalar / ATP ve NADPH uretir', 'Calvin dongusu karbonu glikoza baglar', 'Calvin dongusu dogrudan isik istemez'], maxPoints: 3, explanation: '' }
    ]
  };

  // Return a deep copy so the loaded deck can be mutated safely.
  function get() {
    const src = i18n.getLang() === 'tr' ? TR : EN;
    return JSON.parse(JSON.stringify(src));
  }

  return { get };
})();
