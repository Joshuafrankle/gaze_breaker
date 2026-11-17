import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { BreakerSystem } from './breaker.js';
import { PanelSystem } from './panel.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(BreakerSystem);
  world.registerSystem(PanelSystem);
});
