import { GizmoCluster } from '../../ui/GizmoCluster.js';
import { IconGridMenu } from '../../ui/IconGridMenu.js';
import { icon } from '../../ui/icons.js';
import { FEATURE_KINDS, OPENING_PROFILES } from '../ConstructionSchema.js';
import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { adjustDelta, motionPrecision, snappedValue } from '../curve/CurveSnapping.js';
import { createCurveArcTable } from '../masonry/CurveArcTable.js';
import { CONSTRUCTION_DIRECT_GIZMO_CONFIG as DIRECT_CONFIG } from '../config/ConstructionDirectGizmoConfig.generated.js';
import {
  constructionCentroid,
  nominalTopHeightAtAnchor,
  setAnchorTopHeight,
  translateConstructionRecord,
} from './ConstructionDirectGizmoModel.js';
import { ConstructionDirectGizmoView } from './ConstructionDirectGizmoView.js';

/**
 * The on-selection action cluster and the opening-variant grid behind it.
 *
 * Complements the right-click `ConstructionPaletteController` rather than
 * repeating it: the radial palette answers "what does this wall look like"
 * — colour, bond, top — and this answers "what do I do to it".
 *
 * The split is a shape argument. Look is a small set of exclusive choices, which
 * a radial menu aims at well. Openings are six kinds crossed with four profiles,
 * which will not fit on a ring and which the user wants to compare side by side.
 *
 * Owns menu state only. What the next cut carves lives on the editor controller,
 * because the Alt-drag gesture reads it too and two copies would disagree the
 * first time someone used the modifier instead of the menu.
 */

/**
 * Openings a cut can produce. `tower` and `breach` are in `FEATURE_KINDS` but
 * are authored on a record rather than drawn, so they are not offered here.
 */
const CUTTABLE_KINDS = Object.freeze(['door', 'window', 'arch', 'gate']);
const PRIMARY_POINTER_BUTTON = 0;
/**
 * Shift's factor for whole-wall moves. The direct-gizmo config has no precision
 * entry for the move ring, so it borrows the width handle's — Shift means finer
 * motion on every wall gesture, and a move drag is one of them.
 */
const MOVE_PRECISION_MULTIPLIER = 0.25;

const KIND_LABELS = Object.freeze({
  door: 'Door',
  window: 'Window',
  arch: 'Archway',
  gate: 'Gate',
});

const PROFILE_LABELS = Object.freeze({
  round: 'Round arch',
  segmental: 'Segmental arch',
  pointed: 'Pointed arch',
  flat: 'Flat lintel',
});

function arcTableFor(record) {
  if (!record || record.path?.type !== 'cubicBezier') return null;
  return createCurveArcTable(sampleCubicBezierPath(record.path));
}

export class ConstructionGizmoController {
  constructor({ host, controller, palette = null, onStatus = null }) {
    this.controller = controller;
    this.palette = palette;
    this.onStatus = onStatus;
    this.constructionId = null;
    this.anchor = { clientX: 0, clientY: 0 };
    this.directDrag = null;

    this.cluster = new GizmoCluster({
      host,
      modifier: 'icon-gizmo--construction',
      onAction: (action) => this.action(action),
    });
    this.grid = new IconGridMenu({
      host,
      modifier: 'icon-grid--construction',
      onSelect: (id) => this.select(id),
    });

    this.directView = controller.constructionView
      ? new ConstructionDirectGizmoView({ constructionView: controller.constructionView })
      : null;
    this.canvas = controller.canvas ?? null;
    this.boundDirectHandlers = {
      pointerDown: (event) => this.onDirectPointerDown(event),
      pointerMove: (event) => this.onDirectPointerMove(event),
      pointerUp: (event) => this.onDirectPointerUp(event),
      pointerCancel: (event) => this.onDirectPointerCancel(event),
    };
    if (this.canvas && this.directView) {
      this.canvas.addEventListener('pointerdown', this.boundDirectHandlers.pointerDown, true);
      this.canvas.addEventListener('pointermove', this.boundDirectHandlers.pointerMove, true);
      this.canvas.addEventListener('pointerup', this.boundDirectHandlers.pointerUp, true);
      this.canvas.addEventListener('pointercancel', this.boundDirectHandlers.pointerCancel, true);
    }
    this.unsubscribeController = controller.subscribe?.(() => this.syncDirectGizmo()) ?? null;
    this.unsubscribeStore = controller.constructionStore?.subscribe?.(() => this.syncDirectGizmo()) ?? null;
    this.syncDirectGizmo();
  }

  get isOpen() {
    return this.cluster.isOpen;
  }

  get isGridOpen() {
    return this.grid.isOpen;
  }

  /** What the next cut carves. The controller is the single owner. */
  get opening() {
    return this.controller.constructionOpening ?? { kind: null, profile: 'round', dressed: true };
  }

  /** Actions on the selection itself, arranged as in the reference layout. */
  clusterActions() {
    const stepSnap = Boolean(this.controller.constructionStepSnap);
    return [
      {
        id: 'openings',
        label: 'Openings',
        slot: 'right',
        icon: icon('link'),
        active: this.grid.isOpen,
      },
      { id: 'cut', label: 'Cut an opening', slot: 'top', icon: icon('cut') },
      { id: 'properties', label: 'Wall properties', slot: 'bottom', icon: icon('settings') },
      { id: 'match', label: 'Draw matching wall', slot: 'bottom-right', icon: icon('bond-coursed-rubble') },
      { id: 'delete', label: 'Delete wall', slot: 'left', icon: icon('trash') },
      {
        // Visible because it has to be: Ctrl now means "suppress snapping"
        // everywhere, so quantised heights and widths are reachable only here.
        id: 'snapping',
        label: stepSnap ? 'Snapping steps on' : 'Snapping steps off',
        slot: 'bottom-left',
        icon: icon('center'),
        active: stepSnap,
      },
    ];
  }

  /**
   * Three rows: kind, arch profile, and whether the opening is dressed.
   *
   * Built by filtering the schema's own sets rather than listing kinds again, so
   * a kind added to `FEATURE_KINDS` cannot quietly miss the menu — and one
   * removed from it cannot linger here as a tile that fails validation on click.
   */
  openingGroups() {
    const { kind, profile, dressed } = this.opening;
    const kinds = CUTTABLE_KINDS.filter((name) => FEATURE_KINDS.has(name));
    const profiles = [...OPENING_PROFILES];
    return [
      {
        id: 'kinds',
        label: 'Opening kind',
        columns: kinds.length,
        items: kinds.map((name) => ({
          id: `kind:${name}`,
          label: KIND_LABELS[name] ?? name,
          icon: icon(name),
          active: kind === name,
        })),
      },
      {
        id: 'profiles',
        label: 'Arch profile',
        columns: profiles.length,
        items: profiles.map((name) => ({
          id: `profile:${name}`,
          label: PROFILE_LABELS[name] ?? name,
          icon: icon(`profile-${name}`),
          active: profile === name,
        })),
      },
      {
        id: 'dressing',
        label: 'Surround',
        columns: 2,
        items: [
          { id: 'dressed:1', label: 'Dressed surround', icon: icon('dressed'), active: dressed },
          { id: 'dressed:0', label: 'Plain opening', icon: icon('plain'), active: !dressed },
        ],
      },
    ];
  }

  open(constructionId, { clientX, clientY }) {
    this.constructionId = constructionId;
    this.anchor = { clientX, clientY };
    this.cluster.open({ clientX, clientY, actions: this.clusterActions() });
    this.syncDirectGizmo();
  }

  close() {
    this.closeGrid();
    this.cluster.close({ notify: false });
    this.constructionId = null;
  }

  closeGrid() {
    this.grid.close({ notify: false });
  }

  /** Re-render both menus in place, so a pick shows as selected immediately. */
  refresh() {
    if (this.grid.isOpen) {
      this.grid.open({ ...this.anchor, groups: this.openingGroups(), focus: false });
    }
    if (this.cluster.isOpen) {
      this.cluster.open({ ...this.anchor, actions: this.clusterActions() });
    }
    this.syncDirectGizmo();
  }

  action(action) {
    if (!this.constructionId) return;
    if (action === 'match') {
      const id = this.constructionId;
      this.close();
      if (this.controller.drawMatchingConstruction(id)) {
        this.onStatus?.('Draw another wall with this look.');
      }
      return;
    }
    if (action === 'openings') {
      if (this.grid.isOpen) this.closeGrid();
      else this.grid.open({ ...this.anchor, groups: this.openingGroups() });
      this.cluster.open({ ...this.anchor, actions: this.clusterActions() });
      return;
    }
    if (action === 'cut') {
      this.controller.armConstructionCut(true);
      this.onStatus?.('Drag across the wall to carve an opening.');
      this.close();
      return;
    }
    if (action === 'properties') {
      const id = this.constructionId;
      this.close();
      this.palette?.openInspector(id);
      return;
    }
    if (action === 'delete') {
      this.controller.setSelectedConstruction(this.constructionId);
      this.close();
      this.controller.deleteSelectedConstruction();
      this.onStatus?.('Wall deleted.');
    }
    if (action === 'snapping') {
      const enabled = !this.controller.constructionStepSnap;
      this.controller.setConstructionStepSnap(enabled);
      this.onStatus?.(enabled
        ? 'Snapping steps on. Ctrl still suppresses them.'
        : 'Free placement.');
      this.refresh();
    }
  }

  select(id) {
    const [field, value] = id.split(':');
    if (field === 'kind') {
      const next = this.opening.kind === value ? null : value;
      this.controller.setConstructionOpening({ kind: next });
      this.onStatus?.(next
        ? `Next cut carves a ${(KIND_LABELS[next] ?? next).toLowerCase()}.`
        : 'Next cut follows the stroke.');
    }
    if (field === 'profile') {
      this.controller.setConstructionOpening({ profile: value });
      this.onStatus?.(`Next opening: ${PROFILE_LABELS[value] ?? value}.`);
    }
    if (field === 'dressed') {
      this.controller.setConstructionOpening({ dressed: value === '1' });
      this.onStatus?.(value === '1' ? 'Openings get a stone surround.' : 'Openings left plain.');
    }
    this.refresh();
  }

  selectedRecord() {
    const id = this.controller.selectedConstructionId;
    return id ? this.controller.constructionStore?.get(id) ?? null : null;
  }

  syncDirectGizmo() {
    if (!this.directView || this.directDrag) return;
    const record = this.selectedRecord();
    if (
      this.controller.tool !== 'construction'
      || this.controller.constructionMode !== 'edit'
      || !record
      || record.path.type !== 'cubicBezier'
    ) {
      this.directView.hide();
      return;
    }
    try {
      this.directView.setRecord(record, arcTableFor(record), this.controller.selectedAnchorId);
    } catch (error) {
      console.error('Failed to refresh construction direct gizmo.', error);
      this.directView.hide();
    }
  }

  consumeDirectEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  restoreDirectDraft(drag) {
    drag.candidate = null;
    this.controller.constructionView?.clearDraft();
    this.directView?.setRecord(drag.before, drag.arcTable, drag.anchorId);
  }

  onDirectPointerDown(event) {
    if (
      event.button !== PRIMARY_POINTER_BUTTON
      || event.altKey || this.controller.constructionCutArmed
      || this.controller.spacePressed || this.controller.isWorldInputBlocked?.()
      || this.directDrag
      || !this.directView
      || this.controller.tool !== 'construction'
      || this.controller.constructionMode !== 'edit'
    ) return;

    this.syncDirectGizmo();
    let hit = this.directView.pick(event.clientX, event.clientY, this.controller.activeCamera);
    // Once selected, the visible wall itself is a move handle. Nodes keep
    // priority, and double-click still reaches the exact node-insertion tool.
    if (!hit && event.detail < 2 && this.controller.selectedConstructionId) {
      const view = this.controller.constructionView;
      const node = view?.pickHandle?.(event.clientX, event.clientY, this.controller.activeCamera);
      const wall = !node && view?.pickConstruction?.(event.clientX, event.clientY, this.controller.activeCamera);
      if (wall === this.controller.selectedConstructionId) hit = { kind: 'move-all', body: true };
    }
    if (!hit) return;

    const before = this.selectedRecord();
    const arcTable = arcTableFor(before);
    if (!before || !arcTable) return;

    if (hit.kind === 'height') {
      const anchorId = hit.anchorId ?? this.controller.selectedAnchorId;
      const startHeight = nominalTopHeightAtAnchor(before, arcTable, anchorId);
      if (!anchorId || !Number.isFinite(startHeight)) return;
      this.directDrag = {
        kind: 'height',
        pointerId: event.pointerId,
        constructionId: before.id,
        anchorId,
        before,
        arcTable,
        startHeight,
        startClientY: event.clientY,
        unitsPerPixel: this.directView.heightUnitsPerPixel(this.controller.activeCamera),
        candidate: null,
      };
    } else if (hit.kind === 'move-all') {
      const centre = constructionCentroid(before);
      if (!centre) return;
      const planeY = this.directView.groundHeight(centre.x, centre.z);
      const startPoint = this.directView.canonicalPointOnHorizontalPlane(
        event.clientX,
        event.clientY,
        this.controller.activeCamera,
        planeY,
      );
      if (!startPoint) return;
      this.directDrag = {
        kind: 'move-all',
        pointerId: event.pointerId,
        constructionId: before.id,
        anchorId: this.controller.selectedAnchorId,
        before,
        arcTable,
        planeY,
        startPoint,
        startClientX: event.clientX,
        startClientY: event.clientY,
        body: hit.body === true,
        candidate: null,
      };
    } else {
      return;
    }

    this.consumeDirectEvent(event);
    if (hit.body) this.close();
    this.canvas?.setPointerCapture?.(event.pointerId);
    this.controller.constructionAudio?.begin('move', { x: 0, y: 0, z: 0 });
  }

  onDirectPointerMove(event) {
    const drag = this.directDrag;
    if (!drag || event.pointerId !== drag.pointerId || !this.directView) return;
    this.consumeDirectEvent(event);

    // A click on the wall is selection, not a tiny accidental translation.
    if (drag.body && !drag.moved) {
      if (Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 4) return;
      drag.moved = true;
    }

    if (drag.kind === 'height') {
      // The modifier policy the anchor drag follows too: Shift is finer motion,
      // the step is an explicit toggle, and Ctrl suppresses it. Ctrl used to
      // *enable* the step here, so the same key meant "free" on an anchor and
      // "quantised" next to it.
      const delta = adjustDelta(
        (drag.startClientY - event.clientY) * drag.unitsPerPixel,
        event,
        {
          step: this.controller.constructionStepSnap ? DIRECT_CONFIG.height.snapStep : null,
          precisionMultiplier: DIRECT_CONFIG.height.precisionMultiplier,
        },
      );
      const top = setAnchorTopHeight(
        drag.before,
        drag.arcTable,
        drag.anchorId,
        drag.startHeight + delta,
      );
      if (!top) {
        this.restoreDirectDraft(drag);
        return;
      }
      drag.candidate = { ...drag.before, top };
      this.controller.constructionAudio?.move({ x: 0, y: delta, z: 0 });
    } else {
      const point = this.directView.canonicalPointOnHorizontalPlane(
        event.clientX,
        event.clientY,
        this.controller.activeCamera,
        drag.planeY,
      );
      if (!point) return;
      const precision = motionPrecision(event, MOVE_PRECISION_MULTIPLIER);
      const candidate = translateConstructionRecord(
        drag.before,
        (point.x - drag.startPoint.x) * precision,
        (point.z - drag.startPoint.z) * precision,
      );
      if (!candidate || candidate === drag.before) {
        this.restoreDirectDraft(drag);
        return;
      }
      drag.candidate = candidate;
      this.controller.constructionAudio?.move({
        x: (point.x - drag.startPoint.x) * precision, y: 0,
        z: (point.z - drag.startPoint.z) * precision,
      });
    }

    this.controller.constructionView?.setDraft(drag.candidate, {
      constructionId: drag.constructionId,
      valid: true,
      anchorId: drag.anchorId,
    });
    this.directView.setRecord(drag.candidate, drag.arcTable, drag.anchorId);
  }

  finishDirectDrag(event, { commit }) {
    const drag = this.directDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.consumeDirectEvent(event);
    if (this.canvas?.hasPointerCapture?.(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.directDrag = null;
    this.controller.constructionAudio?.end();
    this.controller.constructionView?.clearDraft();

    if (commit && drag.candidate) {
      const command = drag.kind === 'height'
        ? {
          type: 'set_top_profile',
          constructionId: drag.constructionId,
          top: drag.candidate.top,
        }
        : {
          type: 'replace',
          constructionId: drag.constructionId,
          record: drag.candidate,
          dirtySegmentIds: [],
        };
      const change = this.controller.runConstructionCommand(command);
      if (change) {
        this.controller.setSelectedConstruction(drag.constructionId, drag.anchorId);
        this.onStatus?.(drag.kind === 'height'
          ? 'Wall control height updated.'
          : 'Wall moved as one piece.');
      }
    }
    this.syncDirectGizmo();
  }

  onDirectPointerUp(event) {
    this.finishDirectDrag(event, { commit: true });
  }

  onDirectPointerCancel(event) {
    this.finishDirectDrag(event, { commit: false });
  }

  cancelDirectDrag() {
    if (!this.directDrag) return;
    this.finishDirectDrag({ pointerId: this.directDrag.pointerId,
      preventDefault() {}, stopImmediatePropagation() {} }, { commit: false });
  }

  dispose() {
    this.cancelDirectDrag();
    this.unsubscribeController?.();
    this.unsubscribeStore?.();
    if (this.canvas && this.directView) {
      this.canvas.removeEventListener('pointerdown', this.boundDirectHandlers.pointerDown, true);
      this.canvas.removeEventListener('pointermove', this.boundDirectHandlers.pointerMove, true);
      this.canvas.removeEventListener('pointerup', this.boundDirectHandlers.pointerUp, true);
      this.canvas.removeEventListener('pointercancel', this.boundDirectHandlers.pointerCancel, true);
    }
    this.directView?.dispose();
    this.cluster.dispose();
    this.grid.dispose();
  }
}
