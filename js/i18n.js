// ===== i18n Module =====
const i18n = (() => {
  const STORAGE_KEY = 'flashmind_lang';
  let lang = localStorage.getItem(STORAGE_KEY) || 'en';

  const translations = {
    en: {
      // Input view
      tagline: 'Paste. Learn. Ace.',
      tabPaste: 'Paste Text',
      tabPdf: 'Upload PDF',
      tabTopic: 'Just a Topic',
      pasteHolder: 'Paste your notes, textbook content, lecture transcript, or any study material...',
      charCount: '{n} characters',
      clear: 'Clear',
      dropText: 'Drop a PDF here or click to browse',
      dropHint: 'Supports any text-based PDF',
      extracting: 'Extracting text...',
      extractingPage: 'Extracting text... Page {c}/{t}',
      useText: 'Use this text',
      remove: 'Remove',
      topicHolder: "Enter a topic (e.g., 'Photosynthesis', 'World War II causes', 'Python lists')",
      generateBtn: 'Generate Study Materials',
      generating: 'Generating...',
      ctrlEnter: 'Ctrl + Enter',
      pages: '{n} pages',

      // Study view top bar
      studyMaterials: 'Study Materials',
      share: 'Share',
      export_: 'Export',
      newMaterial: 'New Material',
      notesMd: 'Notes as Markdown',
      notesPdf: 'Notes as PDF',
      cardsCsv: 'Flashcards as CSV',
      quizText: 'Quiz as Text',
      allJson: 'Everything as JSON',

      // Study tabs
      tabNotes: 'Notes',
      tabFlashcards: 'Flashcards',
      tabQuiz: 'Quiz',
      tabChat: 'Ask AI',

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
      quizInfo: '{n} questions \u00B7 {mc} multiple choice, {oe} written',
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
      expires30: 'Expires in 30 days',
      shareCreated: 'Share link created! Expires in 30 days.',
      shareFailed: 'Failed to create share link:',
      shareLoading: 'Loading shared study materials...',
      shareLoaded: 'Shared study materials loaded!',
      shareExpired: 'Share link expired or not found',
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

      // Language
      langEn: 'EN',
      langTr: 'TR',
    },

    tr: {
      // Input view
      tagline: 'Yapistir. Ogren. Basarili Ol.',
      tabPaste: 'Metin Yapistir',
      tabPdf: 'PDF Yukle',
      tabTopic: 'Sadece Konu',
      pasteHolder: 'Notlarinizi, ders kitabi icerigini, ders yazisini veya herhangi bir calisma materyalini yapistirin...',
      charCount: '{n} karakter',
      clear: 'Temizle',
      dropText: "Bir PDF'yi buraya birakin veya gozatin",
      dropHint: 'Metin tabanli tum PDF dosyalarini destekler',
      extracting: 'Metin cikariliyor...',
      extractingPage: 'Metin cikariliyor... Sayfa {c}/{t}',
      useText: 'Bu metni kullan',
      remove: 'Kaldir',
      topicHolder: "Bir konu girin (ornegin, 'Fotosentez', 'Dunya Savasi nedenleri', 'Python listeleri')",
      generateBtn: 'Calisma Materyalleri Olustur',
      generating: 'Olusturuluyor...',
      ctrlEnter: 'Ctrl + Enter',
      pages: '{n} sayfa',

      // Study view top bar
      studyMaterials: 'Calisma Materyalleri',
      share: 'Paylas',
      export_: 'Disari Aktar',
      newMaterial: 'Yeni Materyal',
      notesMd: 'Notlar (Markdown)',
      notesPdf: 'Notlar (PDF)',
      cardsCsv: 'Kartlar (CSV)',
      quizText: 'Sinav (Metin)',
      allJson: 'Hepsi (JSON)',

      // Study tabs
      tabNotes: 'Notlar',
      tabFlashcards: 'Kartlar',
      tabQuiz: 'Sinav',
      tabChat: "AI'ya Sor",

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
      quizInfo: '{n} soru \u00B7 {mc} coktan secmeli, {oe} yazili',
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
      expires30: '30 gun icinde sona erer',
      shareCreated: 'Paylasim baglantisi olusturuldu! 30 gun gecerlidir.',
      shareFailed: 'Paylasim baglantisi olusturulamadi:',
      shareLoading: 'Paylasilan calisma materyalleri yukleniyor...',
      shareLoaded: 'Paylasilan calisma materyalleri yuklendi!',
      shareExpired: 'Paylasim baglantisi suresi dolmus veya bulunamadi',
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

      // Language
      langEn: 'EN',
      langTr: 'TR',
    }
  };

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

  return { t, getLang, setLang };
})();
