/**
 * Title-screen operative roster + dossier panel (DOM/CSS).
 */

import { CHARACTER_ROSTER, getCharacter } from './characters.js';

export class CharacterSelectController {
  /**
   * @param {{ selectedCharacterId: string; modelsReady: boolean; isRunning: boolean; startGame: () => void }} game
   */
  constructor(game) {
    this.game = game;
    this.viewport = document.getElementById('char-carousel-viewport');
    this.track = document.getElementById('char-carousel-track');
    this.prevBtn = document.getElementById('char-carousel-prev');
    this.nextBtn = document.getElementById('char-carousel-next');
    this.nameEl = document.getElementById('char-detail-name');
    this.codenameEl = document.getElementById('char-dossier-codename');
    this.roleEl = document.getElementById('char-detail-role');
    this.storyEl = document.getElementById('char-detail-story');
    this.statsEl = document.getElementById('char-stats-grid');
    this.lockEl = document.getElementById('char-detail-lock');
    this.startBtn = document.getElementById('start-game-btn');

    this.selectedIndex = Math.max(
      0,
      CHARACTER_ROSTER.findIndex((c) => c.id === game.selectedCharacterId)
    );
    if (this.selectedIndex < 0) this.selectedIndex = 0;

    this._onResize = () => this._layout();
    this._onKey = (e) => this._handleKey(e);

    this._buildCards();
    this._bind();
    this._syncFromIndex();
    requestAnimationFrame(() => this._layout());
  }

  _buildCards() {
    if (!this.track) return;
    this.track.replaceChildren();
    for (let i = 0; i < CHARACTER_ROSTER.length; i++) {
      const c = CHARACTER_ROSTER[i];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'char-card' + (c.playable ? '' : ' char-card-locked');
      el.setAttribute('aria-pressed', 'false');
      el.dataset.index = String(i);
      el.innerHTML = `
        <span class="char-card-name">${c.displayName}</span>
        ${c.playable ? '' : '<span class="char-card-lock" aria-hidden="true">LOCKED</span>'}
      `;
      el.addEventListener('click', () => this.setIndex(i));
      this.track.appendChild(el);
    }
  }

  _bind() {
    this.prevBtn?.addEventListener('click', () => this.setIndex(this.selectedIndex - 1));
    this.nextBtn?.addEventListener('click', () => this.setIndex(this.selectedIndex + 1));

    this.startBtn?.addEventListener('pointerup', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      if (!this.game.modelsReady || this.game.isRunning) return;
      const ch = getCharacter(this.game.selectedCharacterId);
      if (!ch.playable) return;
      if (this.game.isCinematicReadyForSelection && !this.game.isCinematicReadyForSelection()) return;
      this.game.startGame();
    });

    window.addEventListener('resize', this._onResize, { passive: true });
    window.addEventListener('keydown', this._onKey);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey);
  }

  /** @param {KeyboardEvent} e */
  _handleKey(e) {
    if (!this._isStartScreenActive()) return;
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      this.setIndex(this.selectedIndex - 1);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      this.setIndex(this.selectedIndex + 1);
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const ch = getCharacter(this.game.selectedCharacterId);
      if (!ch.playable || !this.game.modelsReady || this.game.isRunning) return;
      if (this.game.isCinematicReadyForSelection && !this.game.isCinematicReadyForSelection()) return;
      e.preventDefault();
      this.game.startGame();
    }
  }

  _isStartScreenActive() {
    const scr = document.getElementById('start-screen');
    if (!scr) return false;
    return scr.style.display === 'flex' && window.getComputedStyle(scr).display !== 'none';
  }

  setIndex(i) {
    const n = CHARACTER_ROSTER.length;
    if (n === 0) return;
    let next = i % n;
    if (next < 0) next += n;
    this.selectedIndex = next;
    this._syncFromIndex();
    this._layout();
  }

  /** @param {{ stats?: { label: string; value: string; hint?: string }[] } | null} c */
  _renderStats(c) {
    if (!this.statsEl) return;
    this.statsEl.replaceChildren();
    if (!c?.stats?.length) return;
    for (const s of c.stats) {
      const box = document.createElement('div');
      box.className = 'dossier-stat';
      box.innerHTML = `
        <span class="lbl">${s.label}</span>
        <span class="val">${s.value}</span>
        ${s.hint ? `<span class="hint">${s.hint}</span>` : ''}
      `;
      this.statsEl.appendChild(box);
    }
  }

  /** @param {{ dossier?: string } | null} c */
  _renderStory(c) {
    if (!this.storyEl) return;
    this.storyEl.replaceChildren();
    const text = (c?.dossier || '').trim();
    if (!text) return;
    const parts = text.split(/\n\n+/);
    for (const p of parts) {
      const para = document.createElement('p');
      para.textContent = p.trim();
      this.storyEl.appendChild(para);
    }
  }

  _syncFromIndex() {
    const c = CHARACTER_ROSTER[this.selectedIndex];
    if (c) this.game.selectedCharacterId = c.id;

    if (this.nameEl) this.nameEl.textContent = c?.displayName || '';
    if (this.codenameEl) this.codenameEl.textContent = c?.codename || '';
    if (this.roleEl) this.roleEl.textContent = c?.role || '';

    this._renderStats(c || null);
    this._renderStory(c || null);

    if (this.lockEl) {
      const locked = c && !c.playable;
      this.lockEl.hidden = !locked;
      this.lockEl.textContent = locked
        ? 'OPERATIVE SEALED — DEPLOY ASSETS TO UNLOCK THIS SLOT.'
        : '';
    }

    this.game.profilePreview?.syncCharacter(c || null);
    this.game.scheduleCinematicPreloadForSelection?.();

    if (this.startBtn) {
      const cineReady =
        typeof this.game.isCinematicReadyForSelection === 'function'
          ? this.game.isCinematicReadyForSelection()
          : true;
      const ready = !!c?.playable && this.game.modelsReady && cineReady;
      this.startBtn.disabled = !ready;
      let label = 'LOADING…';
      if (this.game.modelsReady) {
        if (!c?.playable) label = 'SELECT A READY FIGHTER';
        else if (!cineReady) label = 'LOADING FIGHTER CLIPS…';
        else label = 'ENTER THE FLOOR';
      }
      this.startBtn.textContent = label;
      this.startBtn.style.opacity = this.game.modelsReady ? '1' : '0.5';
      this.startBtn.style.cursor = ready ? 'pointer' : 'not-allowed';
    }

    const cards = this.track?.querySelectorAll('.char-card');
    cards?.forEach((el, idx) => {
      const on = idx === this.selectedIndex;
      el.classList.toggle('char-card-active', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  refreshStartButton() {
    this._syncFromIndex();
  }

  relayout() {
    requestAnimationFrame(() => this._layout());
  }

  _layout() {
    if (!this.viewport || !this.track) return;
    const cards = this.track.querySelectorAll('.char-card');
    if (!cards.length) return;

    const first = cards[0];
    // Layout width (CSS flex basis), not getBoundingClientRect — transforms would skew centering.
    const cardW = first.offsetWidth || 156;
    const cs = window.getComputedStyle(this.track);
    const gapRaw = cs.columnGap || cs.gap || '20px';
    const gap = parseFloat(String(gapRaw).split(' ')[0]) || 20;
    const step = cardW + gap;

    const vpW = this.viewport.getBoundingClientRect().width;
    const centerOffset = this.selectedIndex * step + cardW / 2;
    const tx = vpW / 2 - centerOffset;
    this.track.style.transform = `translateX(${tx}px)`;
  }
}
