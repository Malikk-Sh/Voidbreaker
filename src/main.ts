import { Game } from './game/game';

const root = document.getElementById('app')!;
document.getElementById('boot')?.remove();
const game = new Game(root);

const params = new URLSearchParams(location.search);
const stage = params.get('stage');
if (stage) {
  game.startStageById(stage);
  addEventListener('pointerdown', () => game.ctx.audio.unlock(), { once: true });
  addEventListener('keydown', () => game.ctx.audio.unlock(), { once: true });
  if (params.has('god')) {
    const w = game.battle!.world;
    const h = w.hero;
    const orig = h.receiveAttack.bind(h);
    h.receiveAttack = (dmg, dx, dz, src, kb) => orig(0 * dmg, dx, dz, src, kb);
  }
}
game.onBattleEnd = (o) => {
  console.log('battle end', o.cleared, JSON.stringify(o.world.run));
  setTimeout(() => game.startStageById(o.stage.id), 500);
};
