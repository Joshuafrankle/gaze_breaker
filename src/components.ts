import { createComponent, defineComponents, Types } from '@iwsdk/core';

// One selectable orb in the 8-step x 5-pitch grid.
export const Cell = createComponent('Cell', {
  step: { type: Types.Int8, default: 0 },
  row: { type: Types.Int8, default: 0 },
  on: { type: Types.Boolean, default: false },
  dwell: { type: Types.Float32, default: 0 },
  pulse: { type: Types.Float32, default: 0 },
});

// One of the mode buttons: 0 = pinch, 1 = look (dwell), 2 = high contrast, 3 = echo.
export const Control = createComponent('Control', {
  kind: { type: Types.Int8, default: 0 },
  dwell: { type: Types.Float32, default: 0 },
});

// Invisible pinch/click target behind the Gaze Breaker bricks.
export const Backdrop = createComponent('Backdrop', { on: { type: Types.Boolean, default: true } });

// One of the accessibility toggles shown between rounds: 0 = calm, 1 = contrast, 2 = assist.
export const Option = createComponent('Option', {
  kind: { type: Types.Int8, default: 0 },
  dwell: { type: Types.Float32, default: 0 },
});

export default defineComponents([Cell, Control, Backdrop, Option]);
