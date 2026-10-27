// ตัวช่วยเสริมเท่านั้น ปิด JavaScript แล้วทุกหน้ายังใช้ได้
const noPreviewImageUrl = '/static/assets/noPreview.svg';

// form[data-confirm] ถามก่อนส่ง
document.addEventListener('submit', (event) => {
  const message = event.target.dataset?.confirm;
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});

// ACL: ติ๊กช่องใน Matrix แล้วส่งฟอร์มของช่องนั้นทันที (ถ้าปิด JS มีปุ่มบันทึกใน noscript)
document.addEventListener('change', (event) => {
  const form = event.target.closest?.('form[data-autosubmit]');
  if (form) {
    form.requestSubmit();
  }
});

// ลิงก์ #id ที่ชี้ไป <details> ให้เปิดส่วนนั้นเลย
const targetDetails = window.location.hash && document.getElementById(window.location.hash.slice(1));
if (targetDetails?.tagName === 'DETAILS') {
  targetDetails.open = true;
}

// ภาพโหลดไม่สำเร็จ ใช้ภาพ noPreview แทนในกรอบเดิม
function useFallbackImage(image) {
  if (!image.src.endsWith(noPreviewImageUrl)) {
    image.src = noPreviewImageUrl;
    image.alt = 'No Preview Image';
  }
}

for (const image of document.querySelectorAll('img[data-fallback]')) {
  image.addEventListener('error', () => useFallbackImage(image));
  if (image.complete && image.naturalWidth === 0) {
    useFallbackImage(image);
  }
}

// งานที่ล็อกอยู่: กันคลิกขวาและลากภาพ (ภาพถูกเบลอที่ Server อยู่แล้ว)
for (const protectedArea of document.querySelectorAll('[data-protected]')) {
  protectedArea.addEventListener('contextmenu', (event) => event.preventDefault());
  protectedArea.addEventListener('dragstart', (event) => event.preventDefault());
}

// ฟอร์มงาน: แท็กแนะนำ 5 อันตามคำที่พิมพ์ (ขึ้นต้นด้วยคำนั้นก่อน) ไม่ตรงเลยก็ซ่อน
const tagInput = document.querySelector('[data-tag-input]');
const tagBox = document.querySelector('[data-tag-suggestions]');
if (tagInput && tagBox) {
  const allTags = JSON.parse(tagInput.dataset.tagSource || '[]');
  const maxShown = 5;
  const readTags = () => tagInput.value.split(/[\s,]+/).filter(Boolean);
  const currentWord = () => (/[\s,]$/.test(tagInput.value) ? '' : (readTags().pop() ?? '').toLowerCase());

  const renderSuggestions = () => {
    const word = currentWord();
    const typed = readTags();
    if (word) typed.pop();
    const used = new Set(typed.map((tag) => tag.toLowerCase()));
    const matches = word
      ? [...allTags.filter((tag) => tag.startsWith(word)), ...allTags.filter((tag) => !tag.startsWith(word) && tag.includes(word))]
      : allTags;
    const shown = matches.filter((tag) => !used.has(tag)).slice(0, maxShown);
    tagBox.replaceChildren(...shown.map((tag) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tag-chip';
      button.dataset.tagSuggestion = tag;
      button.textContent = `#${tag}`;
      item.append(button);
      return item;
    }));
    tagBox.hidden = shown.length === 0;
  };

  tagBox.addEventListener('click', (event) => {
    const suggestion = event.target.closest('[data-tag-suggestion]');
    if (!suggestion) return;
    const tags = readTags();
    if (currentWord()) tags.pop();
    tagInput.value = `${[...tags, suggestion.dataset.tagSuggestion].join(' ')} `;
    tagInput.focus();
    renderSuggestions();
  });
  tagInput.addEventListener('input', renderSuggestions);
  renderSuggestions();
}

// select ที่เปลี่ยนแล้วส่งฟอร์มทันที (จำนวน Log ต่อหน้า)
for (const select of document.querySelectorAll('[data-auto-submit]')) {
  select.addEventListener('change', () => select.form.requestSubmit());
}

// หน้างาน: ปุ่มเลื่อนรูป + ตัวนับ (ปัดเลื่อนเองได้จาก scroll-snap)
for (const carousel of document.querySelectorAll('[data-carousel]')) {
  const track = carousel.querySelector('[data-carousel-track]');
  const previous = carousel.querySelector('[data-carousel-prev]');
  const next = carousel.querySelector('[data-carousel-next]');
  const counter = carousel.querySelector('[data-carousel-count]');
  const slideCount = track.children.length;
  const currentIndex = () => Math.round(track.scrollLeft / track.clientWidth);
  const update = () => {
    const index = currentIndex();
    if (counter) counter.textContent = `${index + 1} / ${slideCount}`;
    if (previous) previous.disabled = index === 0;
    if (next) next.disabled = index === slideCount - 1;
  };
  previous?.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth }));
  next?.addEventListener('click', () => track.scrollBy({ left: track.clientWidth }));
  track.addEventListener('scroll', update, { passive: true });
  update();
}

// ฟอร์มงาน: เลือกรูปแล้วให้เลือกปกได้ และเตือนถ้าเกินจำนวนหรือขนาดรวม
const imageInput = document.querySelector('[data-image-input]');
const newCoverOptions = document.querySelector('[data-new-cover-options]');
if (imageInput && newCoverOptions) {
  const maxFiles = Number(imageInput.dataset.maxFiles);
  const maxBytes = Number(imageInput.dataset.maxBytes);
  const existingCount = Number(imageInput.dataset.existingCount);
  const existingBytes = Number(imageInput.dataset.existingBytes);
  imageInput.addEventListener('change', () => {
    const files = [...imageInput.files];
    const totalBytes = existingBytes + files.reduce((sum, file) => sum + file.size, 0);
    let message = '';
    if (existingCount + files.length > maxFiles) message = `Max ${maxFiles} files`;
    else if (totalBytes > maxBytes) message = `Max ${Math.round(maxBytes / 1048576)} MB total`;
    imageInput.setCustomValidity(message);
    imageInput.reportValidity();
    // value = ลำดับไฟล์ที่ browser ส่ง (n0, n1, ...) แต่แสดงเรียงตามชื่อให้ตรงกับปกอัตโนมัติ
    const ordered = files.map((file, index) => ({ file, index })).sort((a, b) => a.file.name.localeCompare(b.file.name));
    newCoverOptions.replaceChildren(...ordered.map(({ file, index }) => {
      const label = document.createElement('label');
      label.className = 'checkbox cover-new';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'cover';
      radio.value = `n${index}`;
      const preview = document.createElement('img');
      preview.alt = '';
      preview.src = URL.createObjectURL(file);
      const name = document.createElement('span');
      name.textContent = `${file.name} (new)`;
      label.append(radio, preview, name);
      return label;
    }));
    // ไม่มีปกที่เลือกค้างอยู่แล้ว กลับไปใช้ปกอัตโนมัติ
    const form = imageInput.form;
    if (!form.querySelector('input[name="cover"]:checked')) form.querySelector('input[name="cover"]').checked = true;
  });
}
