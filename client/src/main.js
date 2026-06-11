import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, DPR } from './constants.js';
import BootScene from './scenes/BootScene.js';
import LoginScene from './scenes/LoginScene.js';
import BackgroundScene from './scenes/BackgroundScene.js';
import GameScene from './scenes/GameScene.js';
import HudScene from './scenes/HudScene.js';
import InventoryScene from './scenes/InventoryScene.js';
import GarageScene from './scenes/GarageScene.js';
import MapScene from './scenes/MapScene.js';
import MissionsScene from './scenes/MissionsScene.js';
import ShopScene from './scenes/ShopScene.js';
import CorpScene from './scenes/CorpScene.js';

const W = () => Math.floor(window.innerWidth * DPR);
const H = () => Math.floor(window.innerHeight * DPR);

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.bg,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: W(),
    height: H(),
  },
  render: {
    antialias: true,
    antialiasGL: true,
    roundPixels: false,
    powerPreference: 'high-performance',
    pixelArt: false,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  scene: [
    BootScene, LoginScene, BackgroundScene, GameScene, HudScene, 
    InventoryScene, GarageScene, MapScene, MissionsScene, ShopScene, CorpScene
  ],
};

const game = new Phaser.Game(config);

window.addEventListener('resize', () => game.scale.resize(W(), H()));
