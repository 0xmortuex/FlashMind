// ===== 10th-Grade Study Profile (Turkish Lise 2 — MEB müfredatı) =====
// A personalized home tab: pick a subject → topic and FlashMind generates
// notes, flashcards, and a Turkish-style exam for it.
const Profile = (() => {
  const NAME_KEY = 'flashmind.profile.name';
  const RECENT_KEY = 'flashmind.profile.recent';

  // 2025-2026 Lise 2 core subjects and their main units.
  const CURRICULUM = [
    { name: 'Matematik', emoji: '📐', color: '#6366f1', topics: [
      'Sayma ve Olasılık', 'Fonksiyonlar', 'Polinomlar', 'İkinci Dereceden Denklemler',
      'Dörtgenler ve Çokgenler', 'Katı Cisimler (Uzay Geometri)', 'Analitik Geometri'] },
    { name: 'Fizik', emoji: '⚛️', color: '#06b6d4', topics: [
      'Elektrik ve Manyetizma', 'Basınç ve Kaldırma Kuvveti', 'Dalgalar', 'Optik'] },
    { name: 'Kimya', emoji: '🧪', color: '#22c55e', topics: [
      'Kimyanın Temel Kanunları ve Hesaplamalar', 'Karışımlar', 'Asitler, Bazlar ve Tuzlar', 'Kimya Her Yerde'] },
    { name: 'Biyoloji', emoji: '🧬', color: '#14b8a6', topics: [
      'Hücre Bölünmeleri (Mitoz ve Mayoz)', 'Kalıtımın Genel İlkeleri', 'Ekosistem Ekolojisi'] },
    { name: 'Türk Dili ve Edebiyatı', emoji: '📖', color: '#f43f5e', topics: [
      'Hikâye', 'Şiir', 'Destan ve Halk Hikâyesi', 'Roman', 'Tiyatro', 'Biyografi ve Otobiyografi', 'Mektup ve E-posta'] },
    { name: 'Tarih', emoji: '🏛️', color: '#f59e0b', topics: [
      'Selçuklu Türkiyesi', 'Beylikten Devlete Osmanlı (1300-1453)', 'Dünya Gücü Osmanlı (1453-1595)',
      'Osmanlı Merkez Teşkilatı', 'Klasik Çağda Osmanlı Toplumu'] },
    { name: 'Coğrafya', emoji: '🌍', color: '#3b82f6', topics: [
      'Doğal Sistemler (Kayaçlar, İç-Dış Kuvvetler)', 'Yer Şekilleri ve Oluşumu', 'Nüfus ve Göç', 'Türkiye’nin Coğrafyası'] },
    { name: 'İngilizce', emoji: '🌐', color: '#8b5cf6', topics: [
      'School Life', 'Plans', 'Legendary Figures', 'Traditions', 'Travel', 'Helpful Tips', 'Shopping', 'Frequency'] },
    { name: 'Felsefe', emoji: '💭', color: '#64748b', topics: [
      'Felsefeye Giriş', 'Bilgi Felsefesi', 'Varlık Felsefesi', 'Ahlak Felsefesi',
      'Sanat Felsefesi', 'Din Felsefesi', 'Siyaset Felsefesi', 'Bilim Felsefesi'] },
    { name: 'Din Kültürü ve Ahlak Bilgisi', emoji: '🕌', color: '#10b981', topics: [
      'Allah-İnsan İlişkisi', 'Hz. Muhammed ve Gençlik', 'Din ve Hayat',
      'Ahlaki Tutum ve Davranışlar', 'Dünya Hayatı ve Ahiret', 'İslam Düşüncesinde Yorumlar'] },
  ];

  function getName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
  function setName(n) { try { localStorage.setItem(NAME_KEY, n); } catch {} }
  function getRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } }
  function pushRecent(item) {
    let r = getRecent().filter(x => !(x.subject === item.subject && x.topic === item.topic));
    r.unshift(item);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 8))); } catch {}
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  let panel;
  function init() { panel = document.getElementById('profile-panel'); if (panel) render(); }

  function render() {
    if (!panel) return;
    const T = i18n.t;
    const name = getName();
    const recent = getRecent();
    panel.innerHTML = `
      <div class="profile">
        <div class="profile-head">
          <div class="profile-greet">
            <span class="profile-hi">${name ? T('profileHi', { name: esc(name) }) : T('profileHiNoName')}</span>
            <span class="profile-grade">${T('profileGrade')}</span>
          </div>
          <button class="profile-name-btn" id="profile-name-btn">${name ? T('profileEditName') : T('profileSetName')}</button>
        </div>
        <p class="profile-sub">${T('profileSub')}</p>
        ${recent.length ? `<div class="profile-recent">
          <span class="profile-recent-label">${T('profileRecent')}</span>
          <div class="profile-recent-chips">${recent.map(r =>
            `<button class="profile-recent-chip" data-subject="${esc(r.subject)}" data-topic="${esc(r.topic)}">${esc(r.topic)}</button>`).join('')}</div>
        </div>` : ''}
        <div class="profile-subjects">
          ${CURRICULUM.map(s => `
            <div class="subject-card" style="--subject-accent:${s.color}">
              <div class="subject-head"><span class="subject-emoji">${s.emoji}</span><span class="subject-name">${esc(s.name)}</span></div>
              <div class="subject-topics">
                ${s.topics.map(t => `<button class="subject-topic" data-subject="${esc(s.name)}" data-topic="${esc(t)}">${esc(t)}</button>`).join('')}
              </div>
            </div>`).join('')}
        </div>
      </div>`;

    panel.querySelectorAll('.subject-topic, .profile-recent-chip').forEach(btn =>
      btn.addEventListener('click', () => study(btn.dataset.subject, btn.dataset.topic)));
    const nameBtn = document.getElementById('profile-name-btn');
    if (nameBtn) nameBtn.addEventListener('click', editName);
  }

  function editName() {
    const next = window.prompt(i18n.t('profileNamePrompt'), getName());
    if (next != null) { setName(next.trim()); render(); }
  }

  // Fill the Topic tab with a Turkish curriculum prompt and run generation.
  function study(subject, topic) {
    pushRecent({ subject, topic });
    const text = `10. sınıf ${subject} dersi: ${topic}`;
    document.querySelectorAll('.input-tab').forEach(t => t.classList.toggle('active', t.dataset.inputTab === 'topic'));
    document.querySelectorAll('.input-panel').forEach(p => p.classList.toggle('active', p.id === 'topic-panel'));
    const topicInput = document.getElementById('topic-input');
    if (topicInput) topicInput.value = text;
    // Restore the generate controls (hidden while the profile tab was active).
    document.querySelectorAll('.generate-settings, .generate-hint').forEach(el => { el.style.display = ''; });
    const genBtn = document.getElementById('generate-btn');
    if (genBtn) { genBtn.style.display = ''; genBtn.click(); }
  }

  return { init, render };
})();
window.Profile = Profile;
