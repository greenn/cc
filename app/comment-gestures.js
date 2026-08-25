const commentsList = document.querySelector('#comments-list');
const SWIPE_THRESHOLD = 78;
const START_THRESHOLD = 10;

function isInteractive(target) {
  return Boolean(target.closest?.('button, a, input, textarea, select, [contenteditable="true"]'));
}

function bindCard(card) {
  if (!card || card.dataset.gesturesBound === '1') return;
  card.dataset.gesturesBound = '1';

  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let pointerId = null;

  const reset = () => {
    dragging = false;
    pointerId = null;
    dx = 0;
    card.classList.remove('is-swipe-saving', 'is-swipe-deleting', 'is-swipe-dragging');
    card.style.removeProperty('--cc-swipe-x');
  };

  card.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isInteractive(event.target)) return;
    // Keep normal mouse text selection inside comment text. Swipe/drag can start
    // from the avatar, header, footer, or card background; touch works anywhere.
    if (event.pointerType === 'mouse' && event.target.closest?.('.comment-text')) return;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    dragging = false;
    pointerId = event.pointerId;
  });

  card.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return;
    const nextDx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging) {
      if (Math.abs(nextDx) < START_THRESHOLD) return;
      if (Math.abs(nextDx) <= Math.abs(dy) * 1.15) {
        reset();
        return;
      }
      dragging = true;
      card.classList.add('is-swipe-dragging');
      try { card.setPointerCapture(event.pointerId); } catch { /* optional */ }
    }

    dx = Math.max(-150, Math.min(150, nextDx));
    card.style.setProperty('--cc-swipe-x', `${dx}px`);
    card.classList.toggle('is-swipe-saving', dx > 24);
    card.classList.toggle('is-swipe-deleting', dx < -24);
    if (event.cancelable) event.preventDefault();
  });

  const finish = (event) => {
    if (pointerId !== event.pointerId) return;
    const didDrag = dragging;
    const finalDx = dx;

    // Trigger the real card action first. The previous implementation set the
    // click-suppression flag before button.click(), so our own capture listener
    // swallowed that synthetic Save/Delete click and only the animation worked.
    if (finalDx >= SWIPE_THRESHOLD) {
      const save = card.querySelector('[data-action="save"]');
      if (save && !/saved/i.test(save.textContent || '')) save.click();
    } else if (finalDx <= -SWIPE_THRESHOLD) {
      const remove = card.querySelector('[data-action="delete"]');
      if (remove) remove.click();
    }

    // Suppress only the normal click Chrome may synthesize after pointerup.
    // At this point the intended Save/Delete click has already run.
    if (didDrag) {
      card.__ccSuppressClick = true;
      if (event.cancelable) event.preventDefault();
    }

    reset();
  };

  card.addEventListener('pointerup', finish);
  card.addEventListener('pointercancel', reset);
  card.addEventListener('lostpointercapture', () => {
    if (dragging) reset();
  });

  card.addEventListener('click', (event) => {
    if (!card.__ccSuppressClick) return;
    card.__ccSuppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function bindAll() {
  commentsList?.querySelectorAll('.comment-card').forEach(bindCard);
}

if (commentsList) {
  new MutationObserver(bindAll).observe(commentsList, { childList: true });
}

bindAll();
console.info('[CC gestures] swipe right = save, swipe left = delete');
