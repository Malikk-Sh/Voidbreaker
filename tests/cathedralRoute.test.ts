import { describe, it, expect } from 'vitest';
import { cathedralArena, CathedralRoute, CATHEDRAL, BRIDGE_COLLAPSE } from '../src/world/cathedralRoute';
import { Arena, TileState } from '../src/world/arena';
import { RankTracker } from '../src/world/rank';
import { World } from '../src/world/world';
import { StageRunner } from '../src/world/stage';
import { stageById } from '../src/data/stages';
import { inPart } from '../src/data/arenas';

describe('Врата — мост — Свечной зал', () => {
  it('имеет непрерывный плоский проход и сохраняет колодец зала', () => {
    const a = new Arena(cathedralArena());
    for (let z=-20;z>=-49;z-=0.2) expect(a.walkable(0,z),`мост ${z}`).toBe(true);
    expect(a.walkable(0,CATHEDRAL.hallZ)).toBe(false);
    expect(a.walkable(8,CATHEDRAL.hallZ)).toBe(true);
  });
  it('переключает участок один раз и обрушает мост за героем вместо невидимой стены', () => {
    const a=new Arena(cathedralArena()), r=new CathedralRoute(a);
    expect(r.startBridge()).toBe(true);expect(r.startBridge()).toBe(false);
    expect(r.step(0,-35)).toBe(false);expect(r.step(0,-47)).toBe(true);
    expect(r.step(0,-48)).toBe(false);expect(r.collapseStarted).toBe(true);
    expect(a.blocked(0,-42)).toBe(false);
    r.advanceCollapse(BRIDGE_COLLAPSE.duration);
    expect(a.walkable(0,-42)).toBe(false);
    r.win();expect(a.walkable(0,-42)).toBe(false);
  });
  it('начинает бой и при входе с края моста по широкой боковой части зала', () => {
    const a = new Arena(cathedralArena()), r = new CathedralRoute(a); r.startBridge();
    // Перед порогом зал уже шире моста: игрок может обойти центральную полосу входа.
    const path = [[0,-24], [0,-46], [4,-46], [4,-48], [8,-52], [8,-55]];
    let entered = 0;
    for (let i = 1; i < path.length; i++) {
      const [ax,az] = path[i-1], [bx,bz] = path[i], n = Math.ceil(Math.hypot(bx-ax,bz-az) / 0.1);
      for (let j = 0; j <= n; j++) {
        const x = ax + (bx-ax)*j/n, z = az + (bz-az)*j/n;
        expect(a.walkable(x,z), `боковой вход ${x},${z}`).toBe(true);
        if (r.step(x,z)) entered++;
      }
    }
    expect(entered).toBe(1); expect(r.phase).toBe('combat');
  });
  it('не принимает точку вне контура зала за вход', () => {
    const r = new CathedralRoute(new Arena(cathedralArena())); r.startBridge();
    expect(r.step(100,CATHEDRAL.hallZ)).toBe(false);
    expect(r.step(0,-100)).toBe(false);
    expect(r.phase).toBe('bridge');
    expect(r.step(4,-48)).toBe(true);
  });
  it('обвал идёт от зала к Вратам, останавливается на паузе и не затрагивает героя', () => {
    const a = new Arena(cathedralArena()), r = new CathedralRoute(a); r.startBridge();
    const safe = a.tiles.filter(t => t.z < BRIDGE_COLLAPSE.minZ || t.z > BRIDGE_COLLAPSE.maxZ);
    expect(r.advanceCollapse(1)).toBe(0); expect(a.walkable(0,-35)).toBe(true);
    r.step(0,-47);
    const version = a.version;
    expect(r.advanceCollapse(0)).toBe(0); expect(a.version).toBe(version);
    expect(r.advanceCollapse(0.01)).toBeGreaterThan(0);
    expect(a.walkable(0,-42.75)).toBe(false); expect(a.walkable(0,-29.25)).toBe(true);
    expect(a.version).toBeGreaterThan(version); expect(a.tilesDirty).toBe(true);
    r.advanceCollapse(BRIDGE_COLLAPSE.duration);
    for (const tile of safe) expect(tile.state, `целая кромка ${tile.x},${tile.z}`).toBe(TileState.Alive);
    expect(a.walkable(0,-47)).toBe(true); expect(a.walkable(8,CATHEDRAL.hallZ)).toBe(true);
    expect(r.advanceCollapse(1)).toBe(0); expect(r.step(0,-47)).toBe(false);
  });
  it('оставляет настоящий постоянный разрыв после победы и обычного обновления плит', () => {
    const a = new Arena(cathedralArena()), r = new CathedralRoute(a); r.startBridge(); r.step(0,-47);
    // Чужой временный таймер падения не должен воскресить плиту разрушаемого пролёта.
    const transient = a.tileAt(0,-35)!; a.breakTile(transient,6);
    r.advanceCollapse(BRIDGE_COLLAPSE.duration); r.win();
    for (let i=0;i<1200;i++) { r.advanceCollapse(1/60); a.step(1/60); }
    const gap = a.tiles.filter(t => t.z >= BRIDGE_COLLAPSE.minZ && t.z <= BRIDGE_COLLAPSE.maxZ);
    expect(gap.length).toBeGreaterThan(0);
    for (const tile of gap) { expect(tile.state).toBe(TileState.Gone); expect(a.walkable(tile.x,tile.z)).toBe(false); }
    expect(r.phase).toBe('complete'); expect(a.walkable(0,-47)).toBe(true);
  });
  it('враги второго участка появляются в его зале, а не на мосту или у Врат', () => {
    const a=new Arena(cathedralArena()), r=new CathedralRoute(a);r.startBridge();r.step(0,-47);
    const w=new World(a,'cathedral:spawn');w.hero.spawn(0,-48,Math.PI);w.nav.update(0,0,-48,true);
    const def=stageById('1-4')!, runner=new StageRunner(w,def);
    for(const wave of def.waves) for(const sp of [...wave.spawns,...(wave.triggers??[]).map(t=>t.spawn)]) for(let i=0;i<30;i++){
      const p=runner.pickPos(sp,i,30);
      expect(inPart(a.def.encounter!,p.x,p.z,0.35)).toBe(true);
      expect(a.walkable(p.x,p.z)).toBe(true);
    }
  });
  it('новая оценка не наследует пики и комбо пройденного участка', () => {
    const rank=new RankTracker();for(let i=0;i<100;i++)rank.hit(true);rank.endWave();
    expect(rank.stageRank()).not.toBe('D');rank.beginStage();
    expect(rank.stageRank()).toBe('D');expect(rank.bestHits).toBe(0);expect(rank.peakIdx).toBe(0);
  });
});
