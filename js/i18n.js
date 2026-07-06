// ===== i18n Module =====
const i18n = (() => {
  const STORAGE_KEY = 'flashmind_lang';
  let lang = localStorage.getItem(STORAGE_KEY) || 'en';

  const translations = {
    en: {
      // Input view
      tagline: 'Paste. Learn. Ace.',
      tabPaste: 'Paste Text',
      tabPdf: 'Upload PDF / JSON',
      tabTopic: 'Just a Topic',
      pasteHolder: 'Paste your notes, textbook content, lecture transcript, or any study material...',
      charCount: '{n} characters',
      clear: 'Clear',
      dropText: 'Drop a PDF, JSON, or CSV file here, or click to browse',
      dropHint: 'Text-based PDFs, FlashMind JSON, and CSV/TSV flashcards (e.g. Anki exports)',
      extracting: 'Extracting text...',
      extractingPage: 'Extracting text... Page {c}/{t}',
      useText: 'Use this text',
      remove: 'Remove',
      topicHolder: "Enter a topic (e.g., 'Photosynthesis', 'World War II causes', 'Python lists')",
      generateBtn: 'Generate Study Materials',
      generating: 'Generating...',
      genStage1: 'Reading your material...',
      genStage2: 'Writing structured notes...',
      genStage3: 'Building flashcards...',
      genStage4: 'Preparing your exam...',
      ctrlEnter: 'Ctrl + Enter',
      pages: '{n} pages',

      // Study view top bar
      studyMaterials: 'Study Materials',
      share: 'Share',
      export_: 'Export',
      newMaterial: 'New Material',
      addMaterials: 'Add Materials',
      cancel: 'Cancel',
      addingTo: 'Adding to: {title}',
      materialsAdded: 'New materials added to your set',
      importedSet: 'Imported Set',
      jsonImported: 'Study set imported from JSON',
      jsonAsText: 'Loaded JSON as text — edit it or generate study materials',
      jsonInvalid: 'Could not read that JSON file:',
      notesMd: 'Notes as Markdown',
      notesPdf: 'Notes as PDF',
      cardsCsv: 'Flashcards as CSV',
      quizText: 'Quiz as Text',
      allJson: 'Everything as JSON',

      // Study tabs
      tabNotes: 'Notes',
      tabFlashcards: 'Flashcards',
      tabQuiz: 'Exam',
      tabStats: 'Stats',
      tabChat: 'Ask AI',

      // Demo + deck library
      tryExample: 'Try an example',
      demoLoaded: 'Loaded a sample deck — explore every feature!',
      yourDecks: 'Your decks',
      cardsN: '{n} cards',
      questionsN: '{n} questions',
      dueN: '{n} due',
      deleteDeck: 'Delete deck',
      deckDeleted: 'Deck deleted',
      deckOpened: 'Opened: {title}',

      // Spaced repetition
      reviewDue: 'Review due ({n})',
      noDue: 'Nothing due right now — great job!',

      // Stats
      noStatsYet: 'Study some cards or take an exam to see your stats here.',
      statStreak: 'Day streak',
      statReviews: 'Cards reviewed',
      statDue: 'Due now',
      statExams: 'Exams taken',
      reviewsLast14: 'Reviews — last 14 days',
      examHistory: 'Exam history',

      // Flashcards
      flashcardCount: '{n} flashcards',
      filterAll: 'All',
      filterEasy: 'Easy',
      filterMedium: 'Medium',
      filterHard: 'Hard',
      startStudy: 'Start Study Mode',
      generateMore: 'Generate More',
      generatingMore: 'Generating...',
      mastered: 'Mastered',
      reviewing: 'Reviewing',
      unseen: 'Unseen',
      question: 'Question',
      answer: 'Answer',
      flipHint: 'Click or press Space to flip',
      again: 'Again',
      hard: 'Hard',
      gotIt: 'Got it',
      shortcutsHint: 'Space: flip \u00B7 1: Again \u00B7 2: Hard \u00B7 3: Got it',
      deckComplete: 'Deck Complete!',
      time: 'Time',
      studyAgain: 'Study Again',
      takeQuiz: 'Take Quiz',
      exitStudy: 'Exit study mode (Esc)',
      moreAdded: '{n} flashcards added!',

      // Quiz
      testKnowledge: 'Test Your Knowledge',
      quizInfo: '{n} questions \u00B7 {mc} test, {oe} written',
      questionTypes: 'Question types',
      both: 'Both',
      mcOnly: 'MC Only',
      writtenOnly: 'Written Only',
      timer: 'Timer',
      timePerQ: 'Time per question',
      shuffleQ: 'Shuffle questions',
      showExplanations: 'Show explanations',
      afterEach: 'After each',
      afterQuiz: 'After quiz',
      startQuiz: 'Start Quiz',
      noQuestions: 'No questions available for selected type',
      writtenAnswer: 'Written Answer',
      typeAnswer: 'Type your answer here...',
      submitAnswer: 'Submit Answer',
      questionOf: 'Question {c} of {t}',
      grading: 'Grading...',
      aiGrading: 'AI is grading your answer...',
      missedLabel: 'Missed key points:',
      modelAnswer: 'Model answer:',
      noAnswerProvided: 'No answer provided.',
      offlineGrading: 'Matched {m} of {t} key points (offline grading).',
      nextQuestion: 'Next Question \u2192',
      seeResults: 'See Results',
      mcBreakdown: 'Multiple Choice: {c}/{t} | Written: {p}/{m} pts ({n} questions)',
      oeBreakdown: 'Written: {p}/{m} pts ({n} questions)',
      mcCorrect: 'MC Correct',
      mcWrong: 'MC Wrong',
      writtenPts: 'Written Pts',
      avgPerQ: 'Avg/question',
      reviewAnswers: 'Review Answers',
      retakeQuiz: 'Retake Quiz',
      showWrongOnly: 'Show wrong only',
      showAll: 'Show all',
      yourAnswer: 'Your answer:',
      correct: 'Correct:',
      timesUp: "Time's up \u2014 no answer",
      score: 'Score:',
      examTitle: 'Exam',
      allTypes: 'All',
      objectiveOnly: 'Test',
      startExam: 'Start Exam',
      retakeExam: 'Retake Exam',
      typeMc: 'Multiple Choice',
      typeTf: 'True / False',
      typeFill: 'Fill in the Blank',
      typeMatch: 'Matching',
      tfTrue: 'True',
      tfFalse: 'False',
      fillPlaceholder: 'Type the missing word...',
      checkAnswer: 'Check',
      matchChoose: 'Choose...',
      correctLabel: 'Correct:',
      acceptedAnswer: 'Accepted:',
      points100: 'points',
      correctCount: 'Correct',
      wrongCount: 'Wrong',
      blankCount: 'Blank',
      partialCount: 'Partial',
      netScore: 'Net (MC)',
      pairsCorrect: 'pairs correct',
      searchPlaceholder: 'Search notes & exam...',
      searchNoResults: 'No matches found',
      searchInNotes: 'In notes',
      searchInExam: 'In exam',
      searchAnswer: 'Answer:',
      summaryLabel: 'Summary',
      datesLabel: 'Dates',
      mistakesLabel: 'Common mistakes',
      profileTab: '10th Grade',
      profileHi: 'Hi, {name}!',
      profileHiNoName: 'Hi there! 👋',
      profileGrade: '10th Grade · Lise 2',
      profileSetName: 'Set name',
      profileEditName: 'Edit name',
      profileNamePrompt: 'Your name:',
      profileSub: 'Pick a subject and topic — FlashMind builds notes, flashcards, and a Turkish-style exam for it.',
      profileRecent: 'Recently studied',

      // Chat
      chatHeader: 'Ask about your study material',
      chatHolder: 'Ask anything about your study material...',
      starter1: 'Explain the key concepts in simpler terms',
      starter2: 'What are the most important things to remember?',
      starter3: 'Give me a mnemonic to remember this',
      starter4: 'What questions might appear on an exam?',
      starter5: 'Generate 5 more flashcards on the hardest topics',
      starter6: 'Create a harder quiz',
      studyTip: 'Study Tip',
      addToDeck: 'Add to Deck',
      addToQuiz: 'Add to Quiz',
      newFlashcards: 'Here are {n} new flashcards!',
      newQuizQs: 'Generated {n} new quiz questions!',
      chatError: "Sorry, I couldn't process that.",
      flashcardsAdded: 'Flashcards added to deck!',
      questionsAdded: 'Questions added to quiz!',

      // Notes
      keyTerms: 'Key Terms',
      importantDates: 'Important Dates',
      commonMistakes: 'Common Mistakes',
      copyNotes: 'Copy Notes',
      downloadPdf: 'Download as PDF',

      // Export
      notesCopied: 'Notes copied as Markdown!',
      failedCopy: 'Failed to copy',
      cardsExported: 'Flashcards exported as CSV!',
      quizCopied: 'Quiz copied to clipboard!',
      jsonExported: 'Study set exported as JSON!',

      // Share
      shareTitle: 'Share Study Materials',
      shareLabel: 'Anyone with this link can study your materials:',
      copyLink: 'Copy Link',
      copied: 'Copied!',
      shareExpiry: 'Link stays available — no expiry',
      shareCreated: 'Share link created!',
      shareFailed: 'Failed to create share link:',
      shareLoading: 'Loading shared study materials...',
      shareLoaded: 'Shared study materials loaded!',
      shareExpired: 'Share link expired or not found',
      shareLoadError: 'Couldn\'t reach the server to load this link — check your connection and try again',
      shareInvalid: 'This shared link\'s data looks incomplete',
      noDataShare: 'No study materials to share',
      discordCopied: 'Discord message copied to clipboard!',
      shareWhatsapp: 'Study with me! Check out these {title} notes, flashcards & quiz:',
      shareDiscord: '**FlashMind** \u2014 {title}\nNotes, flashcards, quiz & AI tutor all in one link:',

      // Toasts
      pdfFailed: 'Failed to extract PDF text:',
      noInput: 'Please enter some text or a topic first',
      truncated: 'Text truncated to 15,000 characters',
      genFailed: 'Generation failed:',
      restored: 'Restored your previous study materials',

      // Command palette
      palettePlaceholder: 'Type a command or search…',
      paletteNoResults: 'No matches',
      paletteNav: 'Navigate',
      paletteActions: 'Actions',
      cmdToggleTheme: 'Toggle theme',
      cmdToggleSound: 'Toggle sounds & haptics',

      // Sound
      soundOnToast: 'Sounds & haptics on',
      soundOffToast: 'Sounds & haptics off',

      // Keyboard shortcuts overlay
      shortcutsTitle: 'Keyboard shortcuts',
      scPalette: 'Command palette',
      scGenerate: 'Generate (input screen)',
      scFlip: 'Flip card (study mode)',
      scRate: 'Rate card: Again / Hard / Got it',
      scEsc: 'Close overlays / exit study',

      // Mistake notebook
      retakeMistakes: 'Retake mistakes ({n})',
      mistakesHint: 'Questions you got wrong — answer them correctly to clear them.',
      explainThis: 'Explain this',
      explainPrompt: 'I got this exam question wrong: "{q}". The correct answer is: "{a}". Explain why that answer is correct and where I probably went wrong.',

      // Read aloud
      readAloud: 'Read aloud',
      stopReading: 'Stop',

      // CSV import
      csvEmpty: 'No flashcards found in that file (need front,back columns)',
      csvImported: '{n} flashcards imported!',

      // Weak spots
      targetWeak: 'Target weak spots',
      noWeakSpots: 'No weak spots detected yet — study some cards first!',

      // Deck management
      searchDecks: 'Search decks...',
      deckActions: 'Deck actions',
      renameDeck: 'Rename',
      duplicateDeck: 'Duplicate',
      renamePrompt: 'New deck name:',
      deckDuplicated: 'Deck duplicated',

      // Printable exam
      examPdfKey: 'Printable Exam (PDF)',
      answerKey: 'Answer Key',

      // Streaming generation
      genLive: '{f} flashcards · {q} questions written...',

      // Device sync
      syncTitle: 'Sync devices',
      syncDesc: 'Sync your decks and stats across devices — no account needed. Enable sync here, then enter the code on your other device.',
      syncEnable: 'Enable sync',
      syncEnter: 'Enter a code',
      syncEnterPrompt: 'Sync code from your other device:',
      syncCodeLabel: 'Your sync code — enter it on another device:',
      syncCodeWarn: 'Anyone with this code can read and change your decks. Keep it private.',
      syncLast: 'Last synced',
      syncNow: 'Sync now',
      syncDisable: 'Disable',
      syncDone: 'Synced!',
      syncFailed: 'Sync failed:',
      syncEnabled: 'Sync enabled — enter your code on another device',
      syncDisabled: 'Sync disabled on this device',
      syncCodeInvalid: 'That sync code was not found',

      // URL import
      urlHolder: 'https://... (import text from a web page)',
      urlFetch: 'Fetch',
      urlFetching: 'Fetching...',
      urlFetched: 'Page text imported — review it, then generate',
      urlFailed: 'Could not import that page:',

      // Stats extras
      forecastTitle: 'Upcoming reviews — next 7 days',
      activityTitle: 'Study activity — last 6 months',
      todayLabel: 'Today',

      // Language
      langEn: 'EN',
      langTr: 'TR',
    },

    tr: {
      // Input view
      tagline: 'Yapistir. Ogren. Basarili Ol.',
      tabPaste: 'Metin Yapistir',
      tabPdf: 'PDF / JSON Yukle',
      tabTopic: 'Sadece Konu',
      pasteHolder: 'Notlarinizi, ders kitabi icerigini, ders yazisini veya herhangi bir calisma materyalini yapistirin...',
      charCount: '{n} karakter',
      clear: 'Temizle',
      dropText: 'Bir PDF, JSON veya CSV dosyasini buraya birakin',
      dropHint: "Metin tabanli PDF'ler, FlashMind JSON ve CSV/TSV kartlar (orn. Anki)",
      extracting: 'Metin cikariliyor...',
      extractingPage: 'Metin cikariliyor... Sayfa {c}/{t}',
      useText: 'Bu metni kullan',
      remove: 'Kaldir',
      topicHolder: "Bir konu girin (ornegin, 'Fotosentez', 'Dunya Savasi nedenleri', 'Python listeleri')",
      generateBtn: 'Calisma Materyalleri Olustur',
      generating: 'Olusturuluyor...',
      genStage1: 'Materyalin okunuyor...',
      genStage2: 'Notlar yaziliyor...',
      genStage3: 'Kartlar hazirlaniyor...',
      genStage4: 'Sinav olusturuluyor...',
      ctrlEnter: 'Ctrl + Enter',
      pages: '{n} sayfa',

      // Study view top bar
      studyMaterials: 'Calisma Materyalleri',
      share: 'Paylas',
      export_: 'Disari Aktar',
      newMaterial: 'Yeni Materyal',
      addMaterials: 'Materyal Ekle',
      cancel: 'Iptal',
      addingTo: 'Sete ekleniyor: {title}',
      materialsAdded: 'Yeni materyaller setine eklendi',
      importedSet: 'Ice Aktarilan Set',
      jsonImported: 'Calisma seti JSON dosyasindan ice aktarildi',
      jsonAsText: 'JSON metin olarak yuklendi — duzenleyin veya materyal olusturun',
      jsonInvalid: 'JSON dosyasi okunamadi:',
      notesMd: 'Notlar (Markdown)',
      notesPdf: 'Notlar (PDF)',
      cardsCsv: 'Kartlar (CSV)',
      quizText: 'Sinav (Metin)',
      allJson: 'Hepsi (JSON)',

      // Study tabs
      tabNotes: 'Notlar',
      tabFlashcards: 'Kartlar',
      tabQuiz: 'Sınav',
      tabStats: 'Istatistik',
      tabChat: "AI'ya Sor",

      // Demo + deck library
      tryExample: 'Ornek dene',
      demoLoaded: 'Ornek deste yuklendi — tum ozellikleri kesfet!',
      yourDecks: 'Destelerin',
      cardsN: '{n} kart',
      questionsN: '{n} soru',
      dueN: '{n} tekrar',
      deleteDeck: 'Desteyi sil',
      deckDeleted: 'Deste silindi',
      deckOpened: 'Acildi: {title}',

      // Spaced repetition
      reviewDue: 'Tekrar ({n})',
      noDue: 'Su an tekrar yok — harika!',

      // Stats
      noStatsYet: 'Istatistikleri gormek icin kart calis veya sinav yap.',
      statStreak: 'Gun serisi',
      statReviews: 'Calisilir kart',
      statDue: 'Simdi tekrar',
      statExams: 'Yapilan sinav',
      reviewsLast14: 'Tekrarlar — son 14 gun',
      examHistory: 'Sinav gecmisi',

      // Flashcards
      flashcardCount: '{n} kart',
      filterAll: 'Hepsi',
      filterEasy: 'Kolay',
      filterMedium: 'Orta',
      filterHard: 'Zor',
      startStudy: 'Calisma Modunu Baslat',
      generateMore: 'Daha Fazla Olustur',
      generatingMore: 'Olusturuluyor...',
      mastered: 'Ogrenildi',
      reviewing: 'Tekrar',
      unseen: 'Gorulmedi',
      question: 'Soru',
      answer: 'Cevap',
      flipHint: 'Cevirmek icin tiklayin veya Bosluk tusuna basin',
      again: 'Tekrar',
      hard: 'Zor',
      gotIt: 'Bildim',
      shortcutsHint: 'Bosluk: cevir \u00B7 1: Tekrar \u00B7 2: Zor \u00B7 3: Bildim',
      deckComplete: 'Deste Tamamlandi!',
      time: 'Sure',
      studyAgain: 'Tekrar Calis',
      takeQuiz: 'Sinava Gir',
      exitStudy: 'Calisma modundan cik (Esc)',
      moreAdded: '{n} kart eklendi!',

      // Quiz
      testKnowledge: 'Bilgini Test Et',
      quizInfo: '{n} soru \u00B7 {mc} test, {oe} yaz\u0131l\u0131',
      questionTypes: 'Soru turleri',
      both: 'Her Ikisi',
      mcOnly: 'Sadece Test',
      writtenOnly: 'Sadece Yazili',
      timer: 'Zamanlayici',
      timePerQ: 'Soru basina sure',
      shuffleQ: 'Sorulari karistir',
      showExplanations: 'Aciklamalari goster',
      afterEach: 'Her soruda',
      afterQuiz: 'Sinav sonunda',
      startQuiz: 'Sinavi Baslat',
      noQuestions: 'Secilen tur icin soru bulunamadi',
      writtenAnswer: 'Yazili Cevap',
      typeAnswer: 'Cevabin izi buraya yazin...',
      submitAnswer: 'Cevabi Gonder',
      questionOf: 'Soru {c} / {t}',
      grading: 'Derecelendiriliyor...',
      aiGrading: 'AI cevabin izi derecelendiriyor...',
      missedLabel: 'Kacirilan onemli noktalar:',
      modelAnswer: 'Ornek cevap:',
      noAnswerProvided: 'Cevap verilmedi.',
      offlineGrading: '{t} onemli noktanin {m} tanesi eslesti (cevrimdisi derecelendirme).',
      nextQuestion: 'Sonraki Soru \u2192',
      seeResults: 'Sonuclari Gor',
      mcBreakdown: 'Coktan Secmeli: {c}/{t} | Yazili: {p}/{m} puan ({n} soru)',
      oeBreakdown: 'Yazili: {p}/{m} puan ({n} soru)',
      mcCorrect: 'Test Dogru',
      mcWrong: 'Test Yanlis',
      writtenPts: 'Yazili Puan',
      avgPerQ: 'Ort/soru',
      reviewAnswers: 'Cevaplari Incele',
      retakeQuiz: 'Sinavi Tekrarla',
      showWrongOnly: 'Sadece yanlislari goster',
      showAll: 'Hepsini goster',
      yourAnswer: 'Cevabin:',
      correct: 'Dogru:',
      timesUp: 'Sure doldu \u2014 cevap verilmedi',
      score: 'Puan:',
      examTitle: 'S\u0131nav',
      allTypes: 'T\u00fcm\u00fc',
      objectiveOnly: 'Test',
      startExam: 'S\u0131nav\u0131 Ba\u015flat',
      retakeExam: 'S\u0131nav\u0131 Tekrarla',
      typeMc: '\u00c7oktan Se\u00e7meli',
      typeTf: 'Do\u011fru-Yanl\u0131\u015f',
      typeFill: 'Bo\u015fluk Doldurma',
      typeMatch: 'E\u015fle\u015ftirme',
      tfTrue: 'Do\u011fru',
      tfFalse: 'Yanl\u0131\u015f',
      fillPlaceholder: 'Eksik kelimeyi yaz\u0131n...',
      checkAnswer: 'Kontrol Et',
      matchChoose: 'Se\u00e7in...',
      correctLabel: 'Do\u011fru:',
      acceptedAnswer: 'Kabul edilen:',
      points100: 'puan',
      correctCount: 'Do\u011fru',
      wrongCount: 'Yanl\u0131\u015f',
      blankCount: 'Bo\u015f',
      partialCount: 'K\u0131smi',
      netScore: 'Net (\u00c7S)',
      pairsCorrect: 'e\u015fle\u015fme do\u011fru',
      searchPlaceholder: 'Notlar ve s\u0131navda ara...',
      searchNoResults: 'Sonu\u00e7 bulunamad\u0131',
      searchInNotes: 'Notlarda',
      searchInExam: 'S\u0131navda',
      searchAnswer: 'Cevap:',
      summaryLabel: '\u00d6zet',
      datesLabel: 'Tarihler',
      mistakesLabel: 'S\u0131k yap\u0131lan hatalar',
      profileTab: '10. S\u0131n\u0131f',
      profileHi: 'Merhaba, {name}!',
      profileHiNoName: 'Merhaba! \ud83d\udc4b',
      profileGrade: '10. S\u0131n\u0131f \u00b7 Lise 2',
      profileSetName: '\u0130smini gir',
      profileEditName: '\u0130smi d\u00fczenle',
      profileNamePrompt: 'Ad\u0131n:',
      profileSub: 'Bir ders ve konu se\u00e7 \u2014 FlashMind sana notlar, kartlar ve T\u00fcrk usul\u00fc bir s\u0131nav haz\u0131rlas\u0131n.',
      profileRecent: 'Son \u00e7al\u0131\u015f\u0131lanlar',

      // Chat
      chatHeader: 'Calisma materyalin hakkinda sor',
      chatHolder: 'Calisma materyalin hakkinda bir seyler sor...',
      starter1: 'Temel kavramlari daha basit acikla',
      starter2: 'Hatirlanmasi gereken en onemli seyler nelerdir?',
      starter3: 'Bunu hatirlamam icin bir anistirici ver',
      starter4: 'Sinavda cikmasi muhtemel sorular nelerdir?',
      starter5: 'En zor konularda 5 kart daha olustur',
      starter6: 'Daha zor bir sinav olustur',
      studyTip: 'Calisma Ipucu',
      addToDeck: 'Desteye Ekle',
      addToQuiz: 'Sinava Ekle',
      newFlashcards: 'Iste {n} yeni kart!',
      newQuizQs: '{n} yeni sinav sorusu olusturuldu!',
      chatError: 'Uzgunuz, islem yapilamadi.',
      flashcardsAdded: 'Kartlar desteye eklendi!',
      questionsAdded: 'Sorular sinava eklendi!',

      // Notes
      keyTerms: 'Onemli Terimler',
      importantDates: 'Onemli Tarihler',
      commonMistakes: 'Sik Yapilan Hatalar',
      copyNotes: 'Notlari Kopyala',
      downloadPdf: "PDF Olarak Indir",

      // Export
      notesCopied: 'Notlar Markdown olarak kopyalandi!',
      failedCopy: 'Kopyalama basarisiz',
      cardsExported: 'Kartlar CSV olarak disari aktarildi!',
      quizCopied: 'Sinav panoya kopyalandi!',
      jsonExported: 'Calisma seti JSON olarak disari aktarildi!',

      // Share
      shareTitle: 'Calisma Materyallerini Paylas',
      shareLabel: 'Bu baglantiya sahip herkes materyallerinizi calisabilir:',
      copyLink: 'Baglanti Kopyala',
      copied: 'Kopyalandi!',
      shareExpiry: 'Baglanti suresiz olarak kalir',
      shareCreated: 'Paylasim baglantisi olusturuldu!',
      shareFailed: 'Paylasim baglantisi olusturulamadi:',
      shareLoading: 'Paylasilan calisma materyalleri yukleniyor...',
      shareLoaded: 'Paylasilan calisma materyalleri yuklendi!',
      shareExpired: 'Paylasim baglantisi suresi dolmus veya bulunamadi',
      shareLoadError: 'Sunucuya ulasilamadi — baglantinizi kontrol edip tekrar deneyin',
      shareInvalid: 'Bu paylasim baglantisinin verileri eksik gorunuyor',
      noDataShare: 'Paylasilacak calisma materyali yok',
      discordCopied: 'Discord mesaji panoya kopyalandi!',
      shareWhatsapp: 'Benimle calis! Su {title} notlarina, kartlarina ve sinavina bak:',
      shareDiscord: '**FlashMind** \u2014 {title}\nNotlar, kartlar, sinav ve AI ogretmen tek baglantida:',

      // Toasts
      pdfFailed: 'PDF metni cikarilamadi:',
      noInput: 'Lutfen once bir metin veya konu girin',
      truncated: 'Metin 15.000 karaktere kisaltildi',
      genFailed: 'Olusturma basarisiz:',
      restored: 'Onceki calisma materyalleriniz geri yuklendi',

      // Command palette
      palettePlaceholder: 'Komut yazın veya arayın…',
      paletteNoResults: 'Sonuç yok',
      paletteNav: 'Gezin',
      paletteActions: 'Eylemler',
      cmdToggleTheme: 'Temayı değiştir',
      cmdToggleSound: 'Sesleri aç/kapat',

      // Sound
      soundOnToast: 'Ses ve titreşim açık',
      soundOffToast: 'Ses ve titreşim kapalı',

      // Keyboard shortcuts overlay
      shortcutsTitle: 'Klavye kısayolları',
      scPalette: 'Komut paleti',
      scGenerate: 'Oluştur (giriş ekranı)',
      scFlip: 'Kartı çevir (çalışma modu)',
      scRate: 'Kartı değerlendir: Tekrar / Zor / Bildim',
      scEsc: 'Pencereleri kapat / çalışmadan çık',

      // Mistake notebook
      retakeMistakes: 'Yanlışlarını çöz ({n})',
      mistakesHint: 'Yanlış defterin — doğru cevapladıkça sorular silinir.',
      explainThis: 'Bunu açıkla',
      explainPrompt: 'Bu sınav sorusunu yanlış yaptım: "{q}". Doğru cevap: "{a}". Bu cevabın neden doğru olduğunu ve muhtemelen nerede hata yaptığımı açıkla.',

      // Read aloud
      readAloud: 'Sesli oku',
      stopReading: 'Durdur',

      // CSV import
      csvEmpty: 'Dosyada kart bulunamadı (ön,arka sütunları gerekli)',
      csvImported: '{n} kart içe aktarıldı!',

      // Weak spots
      targetWeak: 'Zayıf noktaları çalış',
      noWeakSpots: 'Henüz zayıf nokta tespit edilmedi — önce biraz kart çalış!',

      // Deck management
      searchDecks: 'Destelerde ara...',
      deckActions: 'Deste işlemleri',
      renameDeck: 'Yeniden adlandır',
      duplicateDeck: 'Kopyala',
      renamePrompt: 'Yeni deste adı:',
      deckDuplicated: 'Deste kopyalandı',

      // Printable exam
      examPdfKey: 'Yazdırılabilir Sınav (PDF)',
      answerKey: 'Cevap Anahtarı',

      // Streaming generation
      genLive: '{f} kart · {q} soru yazıldı...',

      // Device sync
      syncTitle: 'Cihaz senkronu',
      syncDesc: 'Destelerini ve istatistiklerini cihazlar arasında eşitle — hesap gerekmez. Burada senkronu aç, kodu diğer cihazına gir.',
      syncEnable: 'Senkronu aç',
      syncEnter: 'Kod gir',
      syncEnterPrompt: 'Diğer cihazındaki senkron kodu:',
      syncCodeLabel: 'Senkron kodun — diğer cihazına gir:',
      syncCodeWarn: 'Bu koda sahip herkes destelerini okuyabilir ve değiştirebilir. Gizli tut.',
      syncLast: 'Son eşitleme',
      syncNow: 'Şimdi eşitle',
      syncDisable: 'Kapat',
      syncDone: 'Eşitlendi!',
      syncFailed: 'Eşitleme başarısız:',
      syncEnabled: 'Senkron açıldı — kodu diğer cihazına gir',
      syncDisabled: 'Bu cihazda senkron kapatıldı',
      syncCodeInvalid: 'Bu senkron kodu bulunamadı',

      // URL import
      urlHolder: 'https://... (web sayfasından metin al)',
      urlFetch: 'Getir',
      urlFetching: 'Getiriliyor...',
      urlFetched: 'Sayfa metni alındı — kontrol et, sonra oluştur',
      urlFailed: 'Sayfa alınamadı:',

      // Stats extras
      forecastTitle: 'Yaklaşan tekrarlar — 7 gün',
      activityTitle: 'Çalışma aktivitesi — son 6 ay',
      todayLabel: 'Bugün',

      // Language
      langEn: 'EN',
      langTr: 'TR',
    }
  };

  // ===== Topic Categories =====
  const topicCategories = {
    en: [
      { name: 'Science', topics: ['Photosynthesis', 'DNA Replication', "Newton's Laws of Motion", 'The Solar System', 'Human Digestive System', 'Periodic Table Basics', 'Electricity & Circuits'] },
      { name: 'History', topics: ['French Revolution', 'World War II Causes', 'Ottoman Empire', 'Cold War', 'Ancient Egypt'] },
      { name: 'Math', topics: ['Quadratic Formula', 'Pythagorean Theorem', 'Fractions & Decimals', 'Probability Basics'] },
      { name: 'Social Sciences', topics: ['Supply & Demand', 'Climate Change', 'Human Rights', 'Types of Government'] },
      { name: 'Languages & Literature', topics: ["Shakespeare's Romeo & Juliet", 'Parts of Speech in English', 'Essay Writing Structure'] },
      { name: 'Technology', topics: ['How the Internet Works', 'Artificial Intelligence Basics', 'Cybersecurity Fundamentals'] }
    ],
    tr: [
      { name: 'Fen Bilimleri', topics: ['Fotosentez', 'DNA Replikasyonu', 'Newton Hareket Yasalari', 'Sindirim Sistemi', 'Periyodik Tablo'] },
      { name: 'Tarih', topics: ['Osmanli Imparatorlugu', 'Kurtulus Savasi', 'Fransiz Devrimi', 'Soguk Savas', 'Eski Misir'] },
      { name: 'Matematik', topics: ['Ikinci Derece Denklemler', 'Pisagor Teoremi', 'Olasilik', 'Kesirler'] },
      { name: 'Sosyal Bilimler', topics: ['Arz ve Talep', 'Iklim Degisikligi', 'Insan Haklari', 'Yonetim Bicimleri'] },
      { name: 'Teknoloji', topics: ['Internet Nasil Calisir', 'Yapay Zeka', 'Siber Guvenlik'] }
    ]
  };

  function getTopicCategories() {
    return topicCategories[lang] || topicCategories.en;
  }

  // Add UI strings for show/hide more topics
  translations.en.showMoreTopics = 'Show more topics \u25BE';
  translations.en.showFewerTopics = 'Show fewer topics \u25B4';
  translations.tr.showMoreTopics = 'Daha fazla konu goster \u25BE';
  translations.tr.showFewerTopics = 'Daha az konu goster \u25B4';

  function t(key, params) {
    let str = (translations[lang] && translations[lang][key]) || translations.en[key] || key;
    if (params) {
      Object.keys(params).forEach(k => {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
      });
    }
    return str;
  }

  function getLang() { return lang; }

  function setLang(newLang) {
    lang = newLang;
    localStorage.setItem(STORAGE_KEY, newLang);
    location.reload();
  }

  return { t, getLang, setLang, getTopicCategories };
})();
