import { describe, expect, it } from 'vitest';
import { FX, FX_NAMES, parseFx } from '../src/render/fx';
import { BODY_FLASH } from '../src/render/materials';
import { CONTACT, contactStretch } from '../src/render/contactShadows';
import { SLASH_HDR } from '../src/vfx/slashFx';
import { RIBBON } from '../src/vfx/trail';
import { HERO_LIGHT, HIT_FX, IMPACT, STUN_FX } from '../src/vfx/battleVfx';
import { RING_LOOK } from '../src/vfx/rings';
import { TELE_LOOK } from '../src/vfx/telegraphs';
import { RAY_LOOK } from '../src/gen/zone/arenaView';
import { CAPTION } from '../src/ui/hud';
import { Cinematics, STAGE_VISTA_T } from '../src/game/cinematics';
import { CameraRig } from '../src/world/camera';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { stageById } from '../src/data/stages';
import { migrate } from '../src/meta/save';
import * as THREE from 'three';

describe('план ×100, фаза 0: флаги ?fx=', () => {
  it('всё новое включено по умолчанию; имена выключают по одному, off — всё', () => {
    for (const n of FX_NAMES) expect(FX[n]).toBe(true);
    const some = parseFx('?fx=shadow,rays');
    expect(some.shadow).toBe(false);
    expect(some.rays).toBe(false);
    expect(some.exposure && some.tele && some.title && some.herolight).toBe(true);
    expect(Object.values(parseFx('?q=low&fx=off')).every((v) => !v)).toBe(true);
    expect(Object.values(parseFx('?fx= tele , nonsense')).filter((v) => !v)).toHaveLength(1);
    expect(Object.values(parseFx('')).every(Boolean)).toBe(true);
  });
});

describe('план ×100, D1: дисциплина яркости', () => {
  it('вспышка тела не выше 0.6 и до эмиссии — силуэт и швы видны', () => {
    expect(BODY_FLASH.white).toBeLessThanOrEqual(0.6);
    expect(BODY_FLASH.early).toBe(true);
  });

  it('у следа узкое ядро до 2 HDR и тело до 1; лента клинка и кольца тусклее прежних', () => {
    expect(SLASH_HDR.body).toBeLessThanOrEqual(1);
    expect(SLASH_HDR.heavyBody).toBeLessThanOrEqual(1);
    expect(SLASH_HDR.core).toBeLessThanOrEqual(2);
    expect(SLASH_HDR.heavyCore).toBeLessThanOrEqual(2);
    expect(RIBBON.core).toBeLessThanOrEqual(2);
    expect(RIBBON.edge[0]).toBeGreaterThan(RIBBON.edge[1]);
    // кольцо: полоса не шире половины радиуса — в начале разлёта не диск; яркость рождения ниже прежней ×2
    expect(RING_LOOK.band).toBeGreaterThan(0);
    expect(RING_LOOK.band).toBeLessThanOrEqual(0.5);
    expect(RING_LOOK.peak).toBeLessThan(2);
    expect(RING_LOOK.body + RING_LOOK.core).toBeCloseTo(1);
  });

  it('искра контакта и вспышка оглушения мельче прежних, у крита — только маленькое белое ядро', () => {
    expect(HIT_FX.alpha).toBeLessThan(0.75);
    expect((HIT_FX.flare + HIT_FX.flareHeavy) * HIT_FX.grow).toBeLessThan(1);
    expect(HIT_FX.critCore).toBeGreaterThan(0);
    expect(HIT_FX.critCore).toBeLessThan(HIT_FX.flare);
    expect(STUN_FX.alpha).toBeLessThan(0.55);
    expect(IMPACT.inner).toBeLessThan(0.35);
  });
});

describe('план ×100, D4: вид телеграфов', () => {
  it('заливка с альфой не выше 0.3, контур тонкий, у ног Пилота заливка прозрачнее', () => {
    expect(Math.max(...TELE_LOOK.fill)).toBeLessThanOrEqual(0.3);
    expect(TELE_LOOK.px).toBeLessThanOrEqual(2.5);
    expect(TELE_LOOK.m).toBeLessThan(0.08);
    expect(TELE_LOOK.heroMin).toBeLessThan(0.6);
    expect(TELE_LOOK.heroFar).toBeGreaterThan(TELE_LOOK.heroNear);
  });
});

describe('план ×100, A2/A4: тень от ключевого света и свет Пилота', () => {
  const key = new THREE.Vector3(-0.4, 0.8, 0.45).normalize();
  it('пятно тени вытягивается по росту тела, в прыжке короче; без роста — круглое', () => {
    expect(CONTACT.stretch).toBeGreaterThan(0);
    expect(contactStretch(0, 0, key)).toBe(0);
    const hero = contactStretch(1.9, 0, key), golem = contactStretch(3.4, 0, key);
    expect(hero).toBeGreaterThan(0.4);
    expect(hero).toBeLessThan(1.9);
    expect(golem).toBeGreaterThan(hero);
    expect(contactStretch(1.9, 2, key)).toBeLessThan(hero);
    expect(contactStretch(1.9, CONTACT.fadeH, key)).toBe(0);
  });

  it('пятно света под Пилотом ×2 (Master Plan §5.3), визор светит перед ним', () => {
    expect(HERO_LIGHT.k).toBe(2);
    expect(HERO_LIGHT.visor).toBeGreaterThan(0);
    expect(HERO_LIGHT.r).toBeGreaterThanOrEqual(2.4);
  });

  it('лучи окон сверху гаснут, но не до нуля', () => {
    expect(RAY_LOOK.top).toBeGreaterThan(0);
    expect(RAY_LOOK.top).toBeLessThan(0.5);
    expect(RAY_LOOK.to).toBeGreaterThan(RAY_LOOK.from);
  });
});

describe('план ×100, H: титр этапа до волны, подпись внизу слева', () => {
  /** Пролёт над ареной: когда показан титр и сколько он живёт (с от начала интро). */
  function introTitle(vista: boolean): { at: number; dur: number; banners: number } {
    const w = new World(new Arena(ARENAS.naves), 'title');
    let now = 0, banners = 0;
    const titles: { at: number; dur: number }[] = [];
    const c = new Cinematics({
      world: w, letterbox: () => {}, slow: () => {}, banner: () => { banners++; }, say: () => {}, flash: () => {}, musicPhase: () => {},
      stinger: () => {}, skipRequested: () => false, once: () => false, title: (_t, _s, _c, dur) => { titles.push({ at: now, dur }); },
    });
    const cam = new CameraRig();
    const v = vista ? { pos: new THREE.Vector3(0, 3, 12), look: new THREE.Vector3(0, 2, 0), drift: new THREE.Vector3(1, 0, 0), fov: 50 } : null;
    c.stageIntro(stageById('1-1')!, { x: 0, z: 0 }, 24, undefined, v);
    for (let i = 0; i < 6 * 60; i++) { now += 1 / 60; c.update(1 / 60, cam); }
    expect(titles).toHaveLength(1);
    return { ...titles[0], banners };
  }

  it('титр сворачивается в подпись раньше, чем выходит первая волна', () => {
    // первая волна — как в бою: с декорацией к концу крана, без — через 3 с
    for (const [vista, wave] of [[false, 3.0], [true, STAGE_VISTA_T.end - 0.1]] as const) {
      const t = introTitle(vista);
      expect(t.banners).toBe(0);
      expect(t.at + t.dur).toBeLessThan(wave);
      expect(t.dur).toBeGreaterThan(CAPTION.fold * 2);
    }
  });

  it('подпись держится и гаснет за секунды, а не висит весь бой', () => {
    expect(CAPTION.hold + CAPTION.out).toBeLessThan(8);
    expect(CAPTION.fold).toBeLessThan(1);
  });
});

describe('план ×100: настройки и косметика', () => {
  it('старое сохранение без режима камеры получает «Кино»', () => {
    const old = migrate({ settings: { shake: 0.5 } } as never);
    expect(old.settings.camMode).toBe('cinema');
    expect(old.settings.shake).toBe(0.5);
  });

  it('эффекты, фон арены и голос не берут Math.random: поток врагов не зависит от того, сколько частиц на экране', () => {
    const src = import.meta.glob(['../src/vfx/*.ts', '../src/render/*.ts', '../src/ui/hud.ts', '../src/ui/font.ts', '../src/audio/ambience.ts', '../src/audio/engine.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(src).length).toBeGreaterThan(20);
    for (const [file, text] of Object.entries(src)) expect(text.includes('Math.random'), file).toBe(false);
  });
});
