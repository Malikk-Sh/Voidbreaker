import type { BossController } from './bossBase';
import type { BossHost } from './hierophant';
import { Devourer, HUNT } from './devourer';
import { DEVOURER_START, LANDING, STONE_MARK, devourerEnd, devourerIntro, devourerShift } from './devourerScenes';

export class DevourerEncounter implements BossController {
  readonly name = 'ПОЖИРАТЕЛЬ';
  readonly phaseMarks = [HUNT.phase2, HUNT.phase3];
  get zoomMul(): number { return this.boss.strings.active ? 1.2 : 1.09; }
  private scene = true;
  private finished = false;
  private flawless = true;
  private hintT = -1;
  private showedGuard = false;
  get phase(): number {
    return this.boss.phase;
  }
  constructor(
    private host: BossHost,
    readonly boss: Devourer,
    private hint: (text: string) => void
  ) {
    const b = boss,
      w = host.world,
      h = w.hero;
    b.inScene = true;
    b.setState('idle');
    b.x = DEVOURER_START[0];
    b.z = DEVOURER_START[2];
    b.facing = -0.23;
    w.bus.on('playerHurt', () => {
      if (b.phase === 3) this.flawless = false;
    });
    host.scene(
      devourerIntro(h.x, h.z),
      {
        stoneTick: () => {
          w.bus.emit('sfx', { id: 'echo_pebble', x: b.stone.x, z: b.stone.z, gain: 0.85 });
          this.echo(b.stone.x, b.stone.z, 1.65);
        },
        stoneImpact: () => {
          w.bus.emit('impact', { kind: 'slam', x: STONE_MARK[0], z: STONE_MARK[2], r: 2.15 });
          w.bus.emit('sfx', { id: 'shatter_stone', x: b.x, z: b.z });
          w.bus.emit('shake', { trauma: 0.10 });
          host.light?.(b.x, 1.8, b.z, 'gold', 2, 5, 0.5);
        },
        bellAnswer: () => {
          const bell = b.bells[0];
          bell.pulse = 1;
          this.echo(bell.x, bell.z, 2.8);
          w.bus.emit('sfx', { id: 'quarry_note', x: bell.x, z: bell.z });
          const dx = b.x - bell.x, dz = b.z - bell.z, len = Math.hypot(dx, dz) || 1;
          w.bus.emit('quarryWave', { x: bell.x, z: bell.z, dx: dx / len, dz: dz / len, len });
          host.light?.(b.x, 1.55, b.z, 'gold', 3.1, 6, 0.58);
        },
      },
      () => {
        b.x = LANDING[0];
        b.z = LANDING[2];
        b.facing = Math.atan2(h.x - b.x, h.z - b.z);
        b.beginHunt(1.2);
        this.scene = false;
        host.startSong();
        this.hintT = 0.1;
      }
    );
  }
  private echo(x: number, z: number, r: number): void {
    this.host.world.bus.emit('shockwave', { x, y: 0.16, z, r, color: 'gold', strength: 0.56 });
  }
  step(dt: number): void {
    if (this.scene || this.finished || this.host.world.hero.dead) return;
    const b = this.boss;
    if (b.motion === 'shift') {
      this.transition(b.phase === 1 ? 2 : 3);
      return;
    }
    if (b.motion === 'dying') {
      this.ending();
      return;
    }
    if (b.throatGuard && !this.showedGuard) {
      this.showedGuard = true;
      this.hint('Зверь прикрыл горло. Пока он лежит, бей сбоку.');
    }
    if (this.hintT >= 0) {
      this.hintT -= dt;
      if (this.hintT < 0) this.hint(b.phase === 1
        ? 'Разруби золотой узел на струне, чтобы открыть горло. Удар по колоколу тоже оглушает зверя.'
        : b.phase === 2 ? 'В Исступлении два узла. Разруби оба, чтобы повалить зверя. Упустишь оба — он прыгнет следом.'
        : 'Эхо возвращается по целой струне. Разруби узел до первого удара или дважды уйди с линии.');
    }
  }
  transition(to: 2 | 3): void {
    const b = this.boss,
      w = this.host.world;
    b.enterScene('shift');
    this.scene = true;
    w.ringWaves.length = 0;
    this.host.scene(
      devourerShift(to, b.x, b.z, w.hero.x, w.hero.z),
      {
        newMovement: () => this.host.musicPhase(to - 1),
        drawBreath: () => w.bus.emit('quarryBreath', { x: b.x, z: b.z, facing: b.facing }),
        echoCry: () => {
          this.echo(b.x, b.z, 5.6);
          this.host.light?.(b.x, 1.9, b.z, 'gold', 1.8, 6, 0.7);
        },
        rimAnswer: (i = 0) => {
          const bell = b.bells[i];
          bell.pulse = 1;
          this.echo(bell.x, bell.z, 2.6);
          w.bus.emit('sfx', { id: 'quarry_note', x: bell.x, z: bell.z, pitch: [1, 1.189, 1.498][i], gain: 0.66 });
          const dx = bell.x - b.x, dz = bell.z - b.z, len = Math.hypot(dx, dz);
          if (len > 0.01) w.bus.emit('quarryWave', { x: b.x, z: b.z, dx: dx / len, dz: dz / len, len });
        },
      },
      () => {
        b.phase = to;
        b.facing = Math.atan2(w.hero.x - b.x, w.hero.z - b.z);
        b.beginHunt(0.9);
        this.scene = false;
        this.hintT = 0.05;
        this.host.musicPhase(to - 1);
      }
    );
  }
  get executable(): boolean {
    const b = this.boss,
      h = this.host.world.hero;
    return (
      !this.scene &&
      b.phase === 3 &&
      b.inWindow &&
      b.hp <= b.maxHp * HUNT.execute &&
      Math.hypot(h.x - b.x, h.z - b.z) < 4.4
    );
  }
  execute(): void {
    if (this.executable) this.ending();
  }
  ending(): void {
    if (this.finished) return;
    const b = this.boss,
      w = this.host.world;
    this.scene = true;
    b.enterScene('dying');
    w.ringWaves.length = 0;
    const cut = () => {
      if (b.dead) return;
      b.finish(w);
      this.echo(b.x, b.z, 5);
      this.host.beam(b.x, b.z);
      w.bus.emit('bossDeath', { x: b.x, z: b.z });
    };
    this.host.scene(devourerEnd(b.x, b.z), { lastBreath: cut }, () => {
      cut();
      this.finished = true;
      this.scene = false;
      this.host.sky('starLit', 1);
      if (this.flawless) this.host.sky('star2', 1);
      this.host.saveStar(this.flawless);
      this.host.finishFight();
    });
  }
  cameraTarget(): Devourer | null {
    return this.boss.dead ? null : this.boss;
  }
  cameraOverride(): void {}
  hudBoss(): Devourer | null {
    return this.scene || this.boss.dead ? null : this.boss;
  }
}
