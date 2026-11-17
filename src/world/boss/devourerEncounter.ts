import type { BossController } from './bossBase';
import type { BossHost } from './hierophant';
import { Devourer, HUNT } from './devourer';
import { DEVOURER_START, LANDING, STONE_MARK, devourerEnd, devourerIntro, devourerShift } from './devourerScenes';

export class DevourerEncounter implements BossController {
  readonly name = 'ПОЖИРАТЕЛЬ';
  readonly phaseMarks = [HUNT.phase2, HUNT.phase3];
  readonly zoomMul = 1.09;
  private scene = true;
  private finished = false;
  private flawless = true;
  private hintT = -1;
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
          w.bus.emit('shake', { trauma: 0.26 });
          host.light?.(b.x, 1.8, b.z, 'gold', 2, 5, 0.5);
        },
      },
      () => {
        b.x = LANDING[0];
        b.z = LANDING[2];
        b.facing = Math.atan2(h.x - b.x, h.z - b.z);
        b.beginHunt(1.2);
        this.scene = false;
        host.startSong();
        this.hintT = 0.7;
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
    if (this.hintT >= 0) {
      this.hintT -= dt;
      if (this.hintT < 0) this.hint('Ударь по колоколу и уйди с пути зверя. После столкновения бей в открытое горло.');
    }
  }
  transition(to: 2 | 3): void {
    const b = this.boss,
      w = this.host.world;
    b.enterScene('shift');
    this.scene = true;
    w.ringWaves.length = 0;
    this.host.scene(
      devourerShift(to, b.x, b.z),
      {
        looseBell: () => {
          b.loose = true;
          b.bells[2].pulse = 1;
          this.echo(0, -5.8, 3.4);
          w.bus.emit('shake', { trauma: 0.25 });
        },
        echoCry: () => {
          this.echo(b.x, b.z, 5.6);
          this.host.light?.(b.x, 1.9, b.z, 'void', 2.2, 6, 0.7);
        },
      },
      () => {
        b.phase = to;
        b.loose = true;
        if (to === 2) {
          b.bells[2].x = 1.8;
          b.x = 0;
          b.z = -4.6;
        }
        b.facing = Math.atan2(w.hero.x - b.x, w.hero.z - b.z);
        b.beginHunt(0.9);
        this.scene = false;
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
