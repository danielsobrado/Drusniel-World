import { STEP_STATES } from './LoadingTracker.js';

/** Opacity of a finished stage by how many rows it has risen above the active one. */
const RISEN_OPACITY = Object.freeze([1, 0.62, 0.36, 0.16]);

/**
 * Where each loading stage sits in the ticker, AAA-style: the active stage holds
 * the bottom row, finished stages rise above it and fade as they climb, and the
 * stages still to come wait unseen below, sliding up into place as their turn
 * arrives. Pure — the overlay turns rows into transforms and CSS transitions do
 * the motion.
 *
 * @param {{ state: string }[]} steps in order
 * @returns {{ row: number, opacity: number }[]} row 0 is the active stage's; negative rows are above it
 */
export function tickerLayout(steps) {
  let active = steps.findIndex((step) => step.state === STEP_STATES.ACTIVE || step.state === STEP_STATES.FAILED);
  if (active === -1) {
    // Nothing running: before the first stage starts the first one waits in the
    // slot; once every stage is done the last one keeps it.
    const lastDone = steps.map((step) => step.state).lastIndexOf(STEP_STATES.DONE);
    active = lastDone === -1 ? 0 : lastDone;
  }
  return steps.map((step, index) => {
    const row = index - active;
    if (row > 0) return { row, opacity: 0 };
    return { row, opacity: RISEN_OPACITY[-row] ?? 0 };
  });
}
