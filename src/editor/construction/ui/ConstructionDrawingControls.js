import './ConstructionDrawingControls.css';

const LABELS = { freehand: 'Draw', line: 'Line', circle: 'Circle' };
const HINTS = {
  freehand: 'Drag on the ground. Return to the start to close a courtyard.',
  line: 'Drag between two points to make a straight wall.',
  circle: 'Drag from the centre to the rim to make a round enclosure.',
};

/** Small persistent tool choices; a selected wall keeps its nearby edit tools. */
export class ConstructionDrawingControls {
  constructor(viewport, controller) {
    this.host = document.createElement('section');
    this.host.className = 'construction-drawing-controls';
    this.host.setAttribute('aria-label', 'Wall creation');
    this.host.innerHTML = `<div role="group" aria-label="Wall shape">${Object.entries(LABELS).map(([id, label]) =>
      `<button type="button" data-wall-shape="${id}" aria-pressed="false">${label}</button>`).join('')}</div>
      <p data-wall-gesture-hint></p>`;
    viewport.append(this.host);
    this.host.addEventListener('click', event => {
      const button = event.target.closest('[data-wall-shape]');
      if (button) controller.selectConstructionShape(button.dataset.wallShape);
    });
    const sync = (state) => {
      this.host.hidden = state.tool !== 'construction';
      this.host.classList.toggle('has-selection', Boolean(state.selectedConstruction));
      for (const button of this.host.querySelectorAll('[data-wall-shape]')) {
        button.setAttribute('aria-pressed', String(button.dataset.wallShape === state.constructionShape));
      }
      this.host.querySelector('[data-wall-gesture-hint]').textContent = state.selectedConstruction
        ? 'Drag the wall to move, a node to bend, its arrow to raise. Alt-drag to cut.'
        : HINTS[state.constructionShape] ?? HINTS.freehand;
    };
    this.unsubscribe = controller.subscribe(sync);
    sync(controller.getState());
  }

  dispose() { this.unsubscribe?.(); this.host.remove(); }
}
