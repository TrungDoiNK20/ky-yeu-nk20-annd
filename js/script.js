document.addEventListener('DOMContentLoaded', () => {
  const DATA = window.NK20_DATA;
  if (!DATA) {
    console.error('Missing data');
    return;
  }

  // Dữ liệu cá nhân được mã hóa trong data/list.js (NK20_ENCRYPTED_LISTS)
  const ENCRYPTED_LISTS = window.NK20_ENCRYPTED_LISTS || [];
  let UNLOCKED_LIST = null; // mảng bản ghi cá nhân sau khi giải mã

  // Chỉ mục thành viên/giáo viên (không chứa thông tin cá nhân) để biết ai thuộc danh sách
  const memberIndexById = new Map();
  const memberIndexByName = new Map();
  (DATA.squads || []).forEach(s => (s.members || []).forEach(m => {
    if (m.id) memberIndexById.set(m.id, m);
    if (m.name) memberIndexByName.set(m.name, m);
  }));
  (DATA.teachers || []).forEach(t => {
    if (t.id) memberIndexById.set(t.id, t);
    if (t.name) memberIndexByName.set(t.name, t);
  });
  const personalFields = ['dob', 'gender', 'hometown', 'noisinh', 'unit', 'phone'];
  const SALT = 'NK20_2026_SALT';
  const ITERATIONS = 100000;

  function deriveKey(phone) {
    return CryptoJS.PBKDF2(phone, SALT, { keySize: 256 / 32, iterations: ITERATIONS, hasher: CryptoJS.algo.SHA256 });
  }

  function tryUnlock(phone) {
    if (!phone || !ENCRYPTED_LISTS.length || typeof CryptoJS === 'undefined') return false;
    const key = deriveKey(phone);
    for (const enc of ENCRYPTED_LISTS) {
      try {
        const iv = CryptoJS.enc.Base64.parse(enc.iv);
        const decrypted = CryptoJS.AES.decrypt(enc.data, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
        const text = decrypted.toString(CryptoJS.enc.Utf8);
        if (!text) continue;
        UNLOCKED_LIST = JSON.parse(text);
        return true;
      } catch (e) {
        // sai khóa hoặc dữ liệu hỏng -> thử bản tiếp theo
      }
    }
    return false;
  }

  function findPersonal(obj) {
    if (!UNLOCKED_LIST) return null;
    return (obj.id && UNLOCKED_LIST.find(x => x.id === obj.id)) ||
           UNLOCKED_LIST.find(x => x.name === obj.name) || null;
  }

  function masked(v) { return v ? '*********' : '*********'; }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
      // Ảnh có thumbnail trong folder *_thumbnail thì hiển thị thumbnail để giảm tải;
      // khi click xem sẽ dùng ảnh gốc (data-full). Nếu thumbnail không tồn tại,
      // onerror sẽ tự fallback về ảnh gốc.
      const thumbSrc = (full) => {
        if (!full) return full;
        const m = String(full).match(/^(NK20|HoatDong)\/(.+)$/);
        if (!m) return full;
        const base = m[2].replace(/\.[^.]+$/, '');
        return m[1] + '/Thumbnail/' + base + '.JPG';
      };
  const formatDate = (d) => d ? d : '—';

  const header = $('#siteHeader');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 40);
  });

  const navToggle = $('#navToggle');
  const mainNav = $('#mainNav');
  navToggle.addEventListener('click', () => mainNav.classList.toggle('open'));
  $$('.main-nav a').forEach(a => a.addEventListener('click', () => mainNav.classList.remove('open')));

  const heroBg = $('#heroBg');
  const heroShapes = document.querySelector('.hero-shapes');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      if (heroBg && y < window.innerHeight) {
        heroBg.style.transform = `translate3d(0, ${y * 0.35}px, 0)`;
      }
      if (heroShapes && y < window.innerHeight) {
        heroShapes.style.transform = `translate3d(0, ${y * 0.15}px, 0)`;
      }
      ticking = false;
    });
  });

  if (window.AOS) AOS.init({
    duration: 800,
    once: true,
    offset: 80
  });

  const statMembers = $('#statMembers');
  const targetCount = DATA.meta.rosterTotal || DATA.meta.totalMembers || 53;
  if (statMembers) {
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      statMembers.textContent = targetCount;
    } else {
      let start = 0;
      const duration = 1400;
      const startTime = performance.now();
      const tick = (now) => {
        const t = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        statMembers.textContent = Math.round(start + (targetCount - start) * eased);
        if (t < 1) requestAnimationFrame(tick);
      };
      // start when hero stats enter viewport
      const statsEl = document.querySelector('.hero-stats');
      if (statsEl && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach(e => {
            if (e.isIntersecting) {
              requestAnimationFrame(tick);
              io.disconnect();
            }
          });
        }, { threshold: 0.3 });
        io.observe(statsEl);
      } else {
        requestAnimationFrame(tick);
      }
    }
  }

  const tabsEl = $('#squadTabs');
  const panelEl = $('#squadPanel');
  let activeSquad = 1;

  const roleRank = (r) => (r === 'A trưởng' ? 0 : r === 'A phó' ? 1 : 2);

  function renderTabs() {
    tabsEl.innerHTML = DATA.squads.map(s => `
      <button class="squad-tab ${s.id === activeSquad ? 'active' : ''}" data-squad="${s.id}" role="tab">
        Tiểu đội ${s.id}
      </button>
    `).join('');
    tabsEl.querySelectorAll('.squad-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSquad = parseInt(btn.dataset.squad, 10);
        renderTabs();
        renderPanel();
      });
    });
  }

  function renderPanel() {
    const s = DATA.squads.find(x => x.id === activeSquad);
    if (!s) return;
    const sortedMembers = [...s.members].sort((a, b) => roleRank(a.role) - roleRank(b.role));
    panelEl.innerHTML = `
      <div class="squad-header">
        <div class="squad-image" id="squadImage"><img src="${encPath(thumbSrc(s.image))}" data-full="${encPath(s.image)}" data-raw="${s.image}" alt="${s.name}" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.full" /></div>
        <div class="squad-info">
          <h3>${s.name}</h3>
          <p class="squad-slogan">${s.slogan}</p>
          <p class="squad-desc">${s.description}</p>
          <p class="squad-count">${s.members.length} THÀNH VIÊN</p>
        </div>
      </div>
      <div class="member-grid">
        ${sortedMembers.map(m => `
          <article class="member-card" data-member-id="${m.id}" data-squad="${s.id}">
            ${m.role ? `<span class="member-badge">${m.role}</span>` : ''}
            <div class="member-photo"><img src="${encPath(thumbSrc(m.image))}" data-full="${encPath(m.image)}" alt="${m.name}" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.full" /></div>
            <div class="member-info">
              <h3 class="member-name">${m.name}</h3>
              <p class="member-role">${m.role || 'Học viên'}</p>
            </div>
          </article>
        `).join('')}
      </div>
    `;
    panelEl.querySelectorAll('.member-card').forEach(card => {
      card.addEventListener('click', () => {
        const sid = parseInt(card.dataset.squad, 10);
        const mid = card.dataset.memberId;
        const squad = DATA.squads.find(x => x.id === sid);
        const member = squad.members.find(x => x.id === mid);
        openMemberModal(member);
      });
    });
    // Click vào ảnh tập thể tiểu đội -> phóng to (lightbox)
    const squadImageEl = panelEl.querySelector('#squadImage');
    if (squadImageEl) {
      squadImageEl.style.cursor = 'zoom-in';
      squadImageEl.addEventListener('click', () => {
        const img = squadImageEl.querySelector('img');
        if (img) openSquadLightbox(img.dataset.raw || img.dataset.full || img.src);
      });
    }
    if (window.AOS) AOS.refresh();
  }

  renderTabs();
  renderPanel();

  const modal = $('#memberModal');
  const modalBody = $('#modalBody');

  function openDetailModal(d) {
    const inList = (d && d.id && memberIndexById.has(d.id)) || (d && d.name && memberIndexByName.has(d.name));
    const isTeacher = (DATA.teachers || []).some(t => (t.id && t.id === d.id) || (t.name && t.name === d.name));
    const personal = inList ? findPersonal(d) : null;
    const unlocked = !!UNLOCKED_LIST;
    const getVal = (f) => {
      if (personal && personal[f]) return personal[f];
      if (d && d[f]) return d[f];
      return '';
    };
    const mask = '*********';
    const phoneVal = inList ? (unlocked ? (getVal('phone') || '') : mask) : (d.phone || '');
    const showPersonalDetails = !isTeacher;
    const dobVal = showPersonalDetails ? (inList ? (unlocked ? (getVal('dob') || '') : mask) : (d.dob || '')) : '';
    const genderVal = showPersonalDetails ? (inList ? (unlocked ? (getVal('gender') || '') : mask) : (d.gender || '')) : '';
    const hometownVal = showPersonalDetails ? (inList ? (unlocked ? (getVal('hometown') || '') : mask) : (d.hometown || '')) : '';
    const noisinhVal = showPersonalDetails ? (inList ? (unlocked ? (getVal('noisinh') || '') : mask) : (d.noisinh || '')) : '';
    const unitVal = showPersonalDetails ? (inList ? (unlocked ? (getVal('unit') || '') : mask) : (d.unit || '')) : '';

    modalBody.innerHTML = `
      <div class="modal-photo">
        <div class="modal-photo-spinner" aria-hidden="true"></div>
        <img src="${encPath(d.image)}" alt="${d.name}" onload="this.classList.add('loaded'); var s=this.parentElement.querySelector('.modal-photo-spinner'); if(s) s.remove();" onerror="this.classList.add('loaded'); var s=this.parentElement.querySelector('.modal-photo-spinner'); if(s) s.remove(); this.src='';" />
      </div>
      <div class="modal-details">
        <h2 class="modal-name">${d.name}</h2>
        <p class="modal-role">${d.role || ''}</p>
        <ul class="modal-meta">
          ${d.rank ? `<li><span class="label">Cấp bậc</span><span class="value">${d.rank}</span></li>` : ''}
          ${d.position ? `<li><span class="label">Chức vụ</span><span class="value">${d.position}</span></li>` : ''}
          <li><span class="label">Số điện thoại</span><span class="value">${phoneVal}</span></li>
          ${dobVal ? `<li><span class="label">Ngày sinh</span><span class="value">${formatDate(dobVal)}</span></li>` : ''}
          ${genderVal ? `<li><span class="label">Giới tính</span><span class="value">${genderVal}</span></li>` : ''}
          ${hometownVal ? `<li><span class="label">Quê quán</span><span class="value">${formatDate(hometownVal)}</span></li>` : ''}
          ${noisinhVal ? `<li><span class="label">Nơi sinh</span><span class="value">${formatDate(noisinhVal)}</span></li>` : ''}
          ${unitVal ? `<li><span class="label">Đơn vị</span><span class="value">${formatDate(unitVal)}</span></li>` : ''}
        </ul>
        ${d.motto ? `<div class="modal-motto">“${d.motto}”</div>` : '<div class="modal-motto empty">Lời nhắn kỷ niệm đang được cập nhật.</div>'}
      </div>
    `;
    modal.classList.add('open');
    document.body.classList.add('no-scroll');
  }

  function openMemberModal(m) {
    if (!m) return;
    openDetailModal({
      name: m.name,
      role: m.role || 'Học viên',
      rank: '',
      position: m.position || '',
      phone: m.phone,
      image: m.image,
      dob: m.dob,
      hometown: m.hometown,
      noisinh: m.noisinh,
      unit: m.unit,
      motto: m.motto
    });
  }

  function closeModal() {
    modal.classList.remove('open');
    document.body.classList.remove('no-scroll');
  }
  $$('[data-close]', modal).forEach(el => el.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeLightbox();
    }
  });

  const teachersGrid = $('#teachersGrid');
  if (teachersGrid && DATA.teachers) {
    teachersGrid.innerHTML = DATA.teachers.map(t => `
      <div class="teacher-card">
        <div class="teacher-photo"><img src="${encPath(thumbSrc(t.image))}" data-full="${encPath(t.image)}" alt="${t.name}" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.full" /></div>
        <div class="teacher-info">
          <h3 class="teacher-name">${t.name}</h3>
          <p class="teacher-role">${t.role}</p>
        </div>
      </div>
    `).join('');

    teachersGrid.querySelectorAll('.teacher-card').forEach((card, idx) => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const t = DATA.teachers[idx];
        openDetailModal({
          name: t.name,
          role: t.role,
          rank: t.rank,
          position: t.position,
          phone: t.phone,
          image: t.image,
          motto: t.motto
        });
      });
    });
  }

  // Officers / Ban cán sự (có thể trống để sau này bổ sung)
  const officersGrid = $('#officersGrid');
  if (officersGrid) {
    const officers = DATA.officers || [];
    if (officers.length) {
      officersGrid.innerHTML = officers.map(o => `
        <div class="officer-card">
          <div class="officer-photo"><img src="${encPath(thumbSrc(o.image))}" data-full="${encPath(o.image)}" alt="${o.name}" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.full" /></div>
          <div class="officer-info">
            <h3 class="officer-name">${o.name}</h3>
            <p class="officer-role">${o.role}</p>
          </div>
        </div>
      `).join('');

      officersGrid.querySelectorAll('.officer-card').forEach((card, idx) => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
          const o = officers[idx];
          try {
            openDetailModal({
              name: o.name,
              role: o.role,
              image: o.image,
              rank: o.rank,
              dob: o.dob,
              gender: o.gender,
              hometown: o.hometown,
              noisinh: o.noisinh,
              unit: o.unit,
              phone: o.phone,
              motto: o.motto
            });
          } catch (e) {
            console.error('Lỗi mở modal officer:', e);
            alert('Không mở được chi tiết cán sự: ' + e.message);
          }
        });
      });
    } else {
      officersGrid.innerHTML = '<p style="text-align:center;color:var(--smoke);">Ban cán sự lớp sẽ được bổ sung sớm.</p>';
    }
  }

  const galleryGrid = $('#galleryGrid');
  const lb = $('#lightbox');
  const lbImg = $('#lbImg');
  let galleryIndex = 0;
  const galleryItems = (DATA.gallery || []).filter(Boolean).map(g => (typeof g === 'string' ? { image: g, thumbnail: thumbSrc(g) } : g));
  const galleryImages = galleryItems.map(g => g.image);

  if (galleryGrid) {
    galleryGrid.innerHTML = galleryItems.map((g, i) => `
      <div class="gallery-item" data-idx="${i}">
        <img src="${encPath(g.thumbnail || thumbSrc(g.image))}" data-full="${encPath(g.image)}" alt="Khoảnh khắc ${i + 1}" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.full" />
      </div>
    `).join('');
    galleryGrid.querySelectorAll('.gallery-item').forEach(item => {
      item.addEventListener('click', () => openLightbox(parseInt(item.dataset.idx, 10)));
    });
  }

  function openLightbox(i) {
    galleryIndex = i;
    lb.classList.add('open', 'loading');
    document.body.classList.add('no-scroll');
    lbImg.onload = () => lb.classList.remove('loading');
    lbImg.onerror = () => lb.classList.remove('loading');
    lbImg.src = encPath(galleryImages[galleryIndex]);
    if (lbImg.complete) lb.classList.remove('loading');
    const prev = lb.querySelector('[data-lb-prev]');
    const next = lb.querySelector('[data-lb-next]');
    if (prev) prev.style.display = '';
    if (next) next.style.display = '';
  }

  function openSquadLightbox(src) {
    if (!src) return;
    lb.classList.add('open', 'loading');
    document.body.classList.add('no-scroll');
    lbImg.onload = () => lb.classList.remove('loading');
    lbImg.onerror = () => lb.classList.remove('loading');
    lbImg.src = src.startsWith('http') ? src : encPath(src);
    if (lbImg.complete) lb.classList.remove('loading');
    const prev = lb.querySelector('[data-lb-prev]');
    const next = lb.querySelector('[data-lb-next]');
    if (prev) prev.style.display = 'none';
    if (next) next.style.display = 'none';
  }

  function closeLightbox() {
    lb.classList.remove('open');
    document.body.classList.remove('no-scroll');
    const prev = lb.querySelector('[data-lb-prev]');
    const next = lb.querySelector('[data-lb-next]');
    if (prev) prev.style.display = '';
    if (next) next.style.display = '';
  }

  function navLightbox(delta) {
    galleryIndex = (galleryIndex + delta + galleryImages.length) % galleryImages.length;
    lb.classList.add('loading');
    lbImg.src = encPath(galleryImages[galleryIndex]);
    if (lbImg.complete) lb.classList.remove('loading');
  }
  $('[data-lb-close]', lb).addEventListener('click', closeLightbox);
  $('[data-lb-prev]', lb).addEventListener('click', () => navLightbox(-1));
  $('[data-lb-next]', lb).addEventListener('click', () => navLightbox(1));
  lb.addEventListener('click', (e) => {
    if (e.target === lb) closeLightbox();
  });

  $$('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 70;
        window.scrollTo({
          top,
          behavior: 'smooth'
        });
      }
    });
  });

  // ==================== Activities timeline ====================
  const activities = DATA.activities || [];

  const timelineEl = $('#actTimeline');
  const searchEl = $('#actSearch');

  // per-event current slide index
  const indices = activities.map(() => 0);

  function slidesForEvent(ei) {
    const a = activities[ei];
    if (!a) return [];
    const q = (searchEl.value || '').trim().toLowerCase();
    let pool = [];
    (a.photos || []).forEach((p, i) => {
      if (!p) return;
      const src = typeof p === 'string' ? p : (p.image || p.thumbnail || '');
      const thumb = typeof p === 'string' ? thumbSrc(p) : (p.thumbnail || thumbSrc(src));
      const cap = (a.captions && a.captions[i]) || a.caption || '';
      const item = {
        src: src,
        thumb: thumb,
        caption: cap,
        video: false
      };
      if (!q || (a.title + ' ' + cap + ' ' + src).toLowerCase().includes(q)) pool.push(item);
    });
    (a.videos || []).forEach((p) => {
      const src = typeof p === 'string' ? p : (p.src || p.image || p.thumbnail || '');
      const cap = a.caption || '';
      const item = {
        src: src,
        thumb: src,
        caption: cap,
        video: true
      };
      if (!q || (a.title + ' ' + cap + ' ' + src).toLowerCase().includes(q)) pool.push(item);
    });
    return pool;
  }

  function renderTimeline() {
    if (!timelineEl || !searchEl) return;
    const q = (searchEl.value || '').trim().toLowerCase();
    let html = '';
    activities.forEach((a, ei) => {
      const slides = slidesForEvent(ei);
      if (q && slides.length === 0) return; // hide events with no matches when filtering
      if (indices[ei] >= slides.length) indices[ei] = 0;
      if (slides.length === 0) indices[ei] = 0;
      const ci = indices[ei];
      const cur = slides[ci];
      const mediaHtml = slides.length === 0 ?
        '<div class="act-event-empty">Chưa có ảnh.</div>' :
        (cur && cur.video ?
          `<video src="${encPath(cur.src)}" controls></video>` :
          `<img src="${cur ? encPath(cur.thumb) : ''}" data-full="${cur ? encPath(cur.src) : ''}" alt="" onerror="this.onerror=null;this.src=this.dataset.full" />`);
      const captionText = cur ? (cur.caption || '') : '';
      const counter = slides.length ? `${ci + 1} / ${slides.length}` : '0 / 0';
      const thumbs = slides.map((s, i) => s.video ?
        `<div class="act-thumb ${i === ci ? 'active' : ''}" data-event="${ei}" data-idx="${i}">▶</div>` :
        `<div class="act-thumb ${i === ci ? 'active' : ''}" data-event="${ei}" data-idx="${i}"><img src="${encPath(s.thumb)}" data-full="${encPath(s.src)}" alt="" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.full" /></div>`).join('');
      html += `
        <article class="act-event" data-event="${ei}">
          <div class="act-event-marker"></div>
          <div class="act-event-body">
            <h3 class="act-event-title">${a.title || ('Sự kiện ' + (ei + 1))}</h3>
            ${a.caption ? `<p class="act-event-caption">${a.caption}</p>` : ''}
            <div class="act-event-stage">
              <button class="act-nav act-prev" data-event="${ei}" aria-label="Ảnh trước">‹</button>
              <div class="act-event-slide">
                ${mediaHtml}
                <div class="act-caption">${captionText}</div>
              </div>
              <button class="act-nav act-next" data-event="${ei}" aria-label="Ảnh sau">›</button>
            </div>
            <div class="act-event-meta">
              <span class="act-event-counter">${counter}</span>
            </div>
            <div class="act-event-thumbs">${thumbs}</div>
          </div>
        </article>
      `;
    });
    if (!html) html = '<p class="act-event-empty">Không có sự kiện phù hợp.</p>';
    timelineEl.innerHTML = html;

    // bind
    timelineEl.querySelectorAll('.act-nav.act-prev').forEach(btn => {
      btn.addEventListener('click', () => {
        const ei = parseInt(btn.dataset.event, 10);
        const slides = slidesForEvent(ei);
        if (!slides.length) return;
        indices[ei] = (indices[ei] - 1 + slides.length) % slides.length;
        renderTimeline();
      });
    });
    timelineEl.querySelectorAll('.act-nav.act-next').forEach(btn => {
      btn.addEventListener('click', () => {
        const ei = parseInt(btn.dataset.event, 10);
        const slides = slidesForEvent(ei);
        if (!slides.length) return;
        indices[ei] = (indices[ei] + 1) % slides.length;
        renderTimeline();
      });
    });
    timelineEl.querySelectorAll('.act-thumb').forEach(t => {
      t.addEventListener('click', () => {
        const ei = parseInt(t.dataset.event, 10);
        const idx = parseInt(t.dataset.idx, 10);
        indices[ei] = idx;
        renderTimeline();
        openActLightbox(ei, idx);
      });
    });

    // click ảnh lớn -> fullscreen
    timelineEl.querySelectorAll('.act-event-slide img, .act-event-slide video').forEach(media => {
      media.style.cursor = 'zoom-in';
      media.addEventListener('click', () => {
        const article = media.closest('.act-event');
        if (!article) return;
        const ei = parseInt(article.dataset.event, 10);
        openActLightbox(ei, indices[ei]);
      });
    });
  }

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      activities.forEach((_, i) => {
        indices[i] = 0;
      });
      renderTimeline();
    });
  }

  // ---------- Fullscreen lightbox for activity images ----------
  const actLb = $('#actLightbox');
  const actLbMedia = $('#actlbMedia');
  const actLbCaption = $('#actlbCaption');
  const actLbCounter = $('#actlbCounter');
  let lbEvent = 0;
  let lbIndex = 0;
  let lbSlides = [];

  function renderActLightbox() {
    const s = lbSlides[lbIndex];
    if (!s) return;
    actLb.classList.add('open', 'loading');
    actLb.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    actLbMedia.innerHTML = s.video ?
      `<video src="${encPath(s.src)}" controls autoplay></video>` :
      `<img src="${encPath(s.src)}" alt="" />`;
    const media = actLbMedia.querySelector('img, video');
    if (media) {
      const done = () => actLb.classList.remove('loading');
      if (media.tagName === 'IMG') {
        media.onload = done;
        media.onerror = done;
      } else {
        media.onloadeddata = done;
        media.onerror = done;
      }
      if (media.complete || (media.readyState && media.readyState >= 2)) done();
    }
    setTimeout(() => actLb.classList.remove('loading'), 3000);
    actLbCaption.textContent = s.caption || '';
    actLbCounter.textContent = (lbIndex + 1) + ' / ' + lbSlides.length;
  }

  function openActLightbox(ei, idx) {
    lbEvent = ei;
    lbSlides = slidesForEvent(ei);
    if (!lbSlides.length) return;
    lbIndex = Math.min(Math.max(idx, 0), lbSlides.length - 1);
    renderActLightbox();
  }

  function closeActLightbox() {
    actLb.classList.remove('open');
    actLb.setAttribute('aria-hidden', 'true');
    actLbMedia.innerHTML = '';
    document.body.classList.remove('no-scroll');
  }

  function navActLightbox(delta) {
    if (!lbSlides.length) return;
    lbIndex = (lbIndex + delta + lbSlides.length) % lbSlides.length;
    indices[lbEvent] = lbIndex;
    renderActLightbox();
    renderTimeline();
  }

  if (actLb) {
    actLb.querySelector('[data-actlb-close]').addEventListener('click', closeActLightbox);
    actLb.querySelector('[data-actlb-prev]').addEventListener('click', () => navActLightbox(-1));
    actLb.querySelector('[data-actlb-next]').addEventListener('click', () => navActLightbox(1));
    actLb.addEventListener('click', (e) => {
      if (e.target === actLb) closeActLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (!actLb.classList.contains('open')) return;
      if (e.key === 'Escape') closeActLightbox();
      if (e.key === 'ArrowLeft') navActLightbox(-1);
      if (e.key === 'ArrowRight') navActLightbox(1);
    });
  }

  // Unlock thông tin cá nhân bằng số điện thoại
  const unlockModal = $('#unlockModal');
  if (unlockModal) {
    const closeUnlock = () => {
      unlockModal.classList.remove('open');
      document.body.classList.remove('no-scroll');
    };
    unlockModal.querySelectorAll('[data-unlock-close]').forEach(el => el.addEventListener('click', closeUnlock));
    const submitBtn = $('#unlockSubmit');
    const skipBtn = $('#unlockSkip');
    const phoneInput = $('#unlockPhone');
    const statusEl = $('#unlockStatus');
    const doUnlock = async () => {
      const phone = (phoneInput.value || '').trim();
      if (!phone) { statusEl.textContent = 'Vui lòng nhập số điện thoại.'; return; }
      statusEl.textContent = 'Đang giải mã...';
      try {
        const ok = tryUnlock(phone);
        if (ok) {
          statusEl.textContent = 'Mở khóa thành công.';
          setTimeout(closeUnlock, 600);
        } else {
          statusEl.textContent = 'Sai số điện thoại. Thông tin hiển thị *********.';
        }
      } catch (e) {
        console.error(e);
        statusEl.textContent = 'Không thể giải mã. Thông tin hiển thị *********.';
      }
    };
    if (submitBtn) submitBtn.addEventListener('click', doUnlock);
    if (skipBtn) skipBtn.addEventListener('click', closeUnlock);
    if (phoneInput) phoneInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock(); });
    // Hiển thị modal ngay khi vào web
    setTimeout(() => {
      unlockModal.classList.add('open');
      document.body.classList.add('no-scroll');
      if (phoneInput) phoneInput.focus();
    }, 800);
  }

  renderTimeline();

  // Ẩn loader sau khi trang đã render xong
  const loaderOverlay = document.getElementById('loaderOverlay');
  if (loaderOverlay) {
    const hideLoader = () => loaderOverlay.classList.add('hidden');
    if (document.readyState === 'complete') {
      hideLoader();
    } else {
      window.addEventListener('load', hideLoader, { once: true });
    }
    setTimeout(hideLoader, 2500);
  }
});