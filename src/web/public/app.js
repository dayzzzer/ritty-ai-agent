const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const commandRow = document.getElementById('commandRow');
const idleVideo = document.getElementById('idleVideo');
const reactionVideo = document.getElementById('reactionVideo');
const idleVideoBg = document.getElementById('idleVideoBg');
const reactionVideoBg = document.getElementById('reactionVideoBg');
const reactionOverlay = document.getElementById('reactionOverlay');

const STORAGE_KEY = 'ritty_web_session_id';
let sessionId = localStorage.getItem(STORAGE_KEY) || crypto.randomUUID();
localStorage.setItem(STORAGE_KEY, sessionId);

let actionPlaying = false;
let actionCleanupTimer = null;
const URL_REGEX = /(https?:\/\/[^\s<>"`]+)/gi;
let imageModal = null;
let imageModalImage = null;

function trimTrailingPunctuation(url) {
  return url.replace(/[),.!?:;]+$/g, '');
}

function ensureImageModal() {
  if (imageModal) {
    return;
  }

  imageModal = document.createElement('div');
  imageModal.className = 'image-modal hidden';
  imageModal.setAttribute('role', 'dialog');
  imageModal.setAttribute('aria-modal', 'true');
  imageModal.setAttribute('aria-label', 'Image preview');

  const content = document.createElement('div');
  content.className = 'image-modal-content';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'image-modal-close';
  closeBtn.setAttribute('aria-label', 'Close image preview');
  closeBtn.textContent = '×';

  imageModalImage = document.createElement('img');
  imageModalImage.className = 'image-modal-image';
  imageModalImage.alt = 'preview';

  content.appendChild(closeBtn);
  content.appendChild(imageModalImage);
  imageModal.appendChild(content);
  document.body.appendChild(imageModal);

  const closeModal = () => {
    if (!imageModal) return;
    imageModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (imageModalImage) {
      imageModalImage.src = '';
    }
  };

  closeBtn.addEventListener('click', closeModal);
  imageModal.addEventListener('click', (event) => {
    if (event.target === imageModal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && imageModal && !imageModal.classList.contains('hidden')) {
      closeModal();
    }
  });
}

function openImageModal(src, alt) {
  if (!src) return;
  ensureImageModal();
  if (!imageModal || !imageModalImage) return;
  imageModalImage.src = src;
  imageModalImage.alt = alt || 'attachment';
  imageModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function appendTextWithLinks(container, text) {
  const input = String(text || '');
  let lastIndex = 0;
  URL_REGEX.lastIndex = 0;

  for (const match of input.matchAll(URL_REGEX)) {
    const fullMatch = match[0];
    const startIndex = match.index ?? 0;
    const cleanUrl = trimTrailingPunctuation(fullMatch);
    const trailing = fullMatch.slice(cleanUrl.length);

    if (startIndex > lastIndex) {
      container.appendChild(document.createTextNode(input.slice(lastIndex, startIndex)));
    }

    if (cleanUrl.length > 0) {
      const link = document.createElement('a');
      link.href = cleanUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
      link.textContent = cleanUrl;
      container.appendChild(link);
    }

    if (trailing) {
      container.appendChild(document.createTextNode(trailing));
    }

    lastIndex = startIndex + fullMatch.length;
  }

  if (lastIndex < input.length) {
    container.appendChild(document.createTextNode(input.slice(lastIndex)));
  }
}

function appendMessage(kind, text, payload = {}) {
  const node = document.createElement('article');
  node.className = `msg ${kind}`;

  const textNode = document.createElement('div');
  textNode.className = 'message-text';
  appendTextWithLinks(textNode, text);
  node.appendChild(textNode);

  if (Array.isArray(payload.sources) && payload.sources.length > 0) {
    const sourceWrap = document.createElement('div');
    sourceWrap.className = 'sources';

    const sourceTitle = document.createElement('div');
    sourceTitle.textContent = 'Sources:';
    sourceWrap.appendChild(sourceTitle);

    for (const source of payload.sources) {
      const row = document.createElement('div');
      appendTextWithLinks(row, source);
      sourceWrap.appendChild(row);
    }

    node.appendChild(sourceWrap);
  }

  if (payload.image) {
    const imageLink = document.createElement('a');
    imageLink.className = 'message-image-link';
    imageLink.href = '#';
    imageLink.setAttribute('aria-label', 'Open image preview');

    const img = document.createElement('img');
    img.className = 'message-image';
    if (payload.image.kind === 'inline') {
      img.src = `data:${payload.image.mimeType || 'image/png'};base64,${payload.image.base64}`;
    } else if (payload.image.kind === 'url') {
      img.src = payload.image.url;
      img.referrerPolicy = 'no-referrer';
    }
    img.alt = payload.image.filename || 'attachment';

    if (img.src) {
      imageLink.dataset.imageSrc = img.src;
    }

    imageLink.addEventListener('click', (event) => {
      event.preventDefault();
      openImageModal(imageLink.dataset.imageSrc || img.src, img.alt);
    });

    imageLink.appendChild(img);
    node.appendChild(imageLink);
  }

  if (payload.quiz && payload.quiz.active && Array.isArray(payload.quiz.options)) {
    const quizWrap = document.createElement('div');
    quizWrap.className = 'quiz-options';

    payload.quiz.options.forEach((option) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${option.key}: ${option.value}`;
      btn.addEventListener('click', () => {
        sendMessage(`/ritualtest ${option.key}`);
      });
      quizWrap.appendChild(btn);
    });

    node.appendChild(quizWrap);
  }

  chatLog.appendChild(node);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function createTypingIndicator() {
  const node = document.createElement('article');
  node.className = 'msg bot typing-indicator';

  const label = document.createElement('span');
  label.className = 'typing-label';
  label.textContent = 'RITTY is typing';
  node.appendChild(label);

  const dots = document.createElement('span');
  dots.className = 'typing-dots';

  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'typing-dot';
    dots.appendChild(dot);
  }

  node.appendChild(dots);
  chatLog.appendChild(node);
  chatLog.scrollTop = chatLog.scrollHeight;
  return node;
}

function removeTypingIndicator(node) {
  if (node && node.parentElement === chatLog) {
    chatLog.removeChild(node);
  }
}

function showIdleVideoState() {
  idleVideo.classList.remove('hidden');
  reactionVideo.classList.add('hidden');
  if (idleVideoBg) idleVideoBg.classList.remove('hidden');
  if (reactionVideoBg) reactionVideoBg.classList.add('hidden');
}

function showReactionVideoState() {
  idleVideo.classList.add('hidden');
  reactionVideo.classList.remove('hidden');
  if (idleVideoBg) idleVideoBg.classList.add('hidden');
  if (reactionVideoBg) reactionVideoBg.classList.remove('hidden');
}

function fallbackReactionFlash() {
  reactionOverlay.classList.remove('hidden');
  setTimeout(() => {
    reactionOverlay.classList.add('hidden');
  }, 900);
}

function cleanupActionPlayback() {
  if (actionCleanupTimer) {
    clearTimeout(actionCleanupTimer);
    actionCleanupTimer = null;
  }
  showIdleVideoState();
  actionPlaying = false;
}

function playAction(actionVideoPayload) {
  if (!actionVideoPayload || !actionVideoPayload.url) {
    return;
  }

  if (actionPlaying) {
    cleanupActionPlayback();
  }

  actionPlaying = true;
  showReactionVideoState();

  reactionVideo.pause();
  reactionVideo.src = actionVideoPayload.url;
  reactionVideo.load();
  reactionVideo.currentTime = 0;

  if (reactionVideoBg) {
    reactionVideoBg.pause();
    reactionVideoBg.src = actionVideoPayload.url;
    reactionVideoBg.load();
    reactionVideoBg.currentTime = 0;
  }

  reactionVideo.play().catch(() => {
    cleanupActionPlayback();
    fallbackReactionFlash();
  });

  if (reactionVideoBg) {
    reactionVideoBg.play().catch(() => {});
  }

  reactionVideo.onended = cleanupActionPlayback;
  reactionVideo.onerror = () => {
    cleanupActionPlayback();
    fallbackReactionFlash();
  };
  actionCleanupTimer = setTimeout(cleanupActionPlayback, 20_000);
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  appendMessage('user', trimmed);
  const typingNode = createTypingIndicator();

  try {
    const response = await fetch('/api/web/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, text: trimmed }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    sessionId = payload.sessionId || sessionId;
    localStorage.setItem(STORAGE_KEY, sessionId);

    removeTypingIndicator(typingNode);
    appendMessage('bot', payload.assistant?.text || 'No response', payload.assistant || {});

    if (payload.assistant?.actionVideo?.url) {
      playAction(payload.assistant.actionVideo);
    }
  } catch (error) {
    removeTypingIndicator(typingNode);
    appendMessage('bot', 'Request failed. Please try again.');
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = chatInput.value;
  chatInput.value = '';
  sendMessage(value);
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

commandRow.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-command]');
  if (!button) return;
  const command = button.getAttribute('data-command');
  if (!command) return;
  chatInput.value = command;
  chatInput.focus();
});

appendMessage('bot', 'RITTY web chat is online. Use normal messages or slash-style commands. Try /actions to see video actions.');
