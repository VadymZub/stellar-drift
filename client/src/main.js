import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS } from './constants.js';
import BootScene from './scenes/BootScene.js';
import LoginScene from './scenes/LoginScene.js';
import BackgroundScene from './scenes/BackgroundScene.js';
import GameScene from './scenes/GameScene.js';
import HudScene from './scenes/HudScene.js';
import InventoryScene from './scenes/InventoryScene.js';
import CargoScene from './scenes/CargoScene.js';
import ClanScene from './scenes/ClanScene.js';
import GarageScene from './scenes/GarageScene.js';
import MapScene from './scenes/MapScene.js';
import MissionsScene from './scenes/MissionsScene.js';
import ShopScene from './scenes/ShopScene.js';
import CorpScene from './scenes/CorpScene.js';
import BaseMenuScene from './scenes/BaseMenuScene.js';
import SkillScene from './scenes/SkillScene.js';

// Canvas at CSS-pixel resolution (1:1 CSS scale, no browser bilinear downscale).
// DPR-based overscaling caused non-integer CSS scaling (e.g. 0.8× at Windows 125%)
// which blurred the entire canvas. Text sharpness is handled separately via resolution:UI_RES.
const W = () => Math.floor(window.innerWidth);
const H = () => Math.floor(window.innerHeight);

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.bg,
  scale: {
    // NONE: Phaser не трогает CSS — мы сами выставляем размер канваса в пикселях окна.
    // Это устраняет искажения FIT при нецелых DPR (Windows 125%, 150% и т.д.).
    mode: Phaser.Scale.NONE,
    width: W(),
    height: H(),
  },
  render: {
    antialias: true,
    antialiasGL: true,
    roundPixels: true,
    powerPreference: 'high-performance',
    pixelArt: false,
    mipmapFilter: 'LINEAR',
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [
    BootScene, LoginScene, BackgroundScene, GameScene, HudScene,
    InventoryScene, CargoScene, ClanScene, GarageScene, MapScene, MissionsScene, ShopScene, CorpScene, BaseMenuScene, SkillScene,
  ],
};

document.fonts.ready.then(() => {
  const game = new Phaser.Game(config);

  function fitCanvas() {
    const c = game.canvas;
    if (!c) return;
    c.style.width  = window.innerWidth  + 'px';
    c.style.height = window.innerHeight + 'px';
    c.style.display = 'block';
  }

  fitCanvas();

  window.addEventListener('resize', () => {
    game.scale.resize(W(), H());
    fitCanvas();
  });
});
