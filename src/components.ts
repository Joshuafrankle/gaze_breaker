import { createComponent, defineComponents, Types } from '@iwsdk/core';

// Invisible pinch/click target behind the Gaze Breaker bricks.
export const Backdrop = createComponent('Backdrop', { on: { type: Types.Boolean, default: true } });

// The streak/rank panel and the rank list: a pinch on either opens or closes the list.
export const Ranks = createComponent('Ranks', { on: { type: Types.Boolean, default: true } });
// One of the accessibility toggles shown between rounds: 0 = calm, 1 = contrast, 2 = assist.
export const Option = createComponent('Option', { kind: { type: Types.Int8, default: 0 } });

export default defineComponents([Backdrop, Ranks, Option]);
