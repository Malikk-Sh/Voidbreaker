import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { obsidianMaterial } from '../../render/materials';
import { GeomBuilder, mat, SURF } from '../geom/build';
import { box, gothicArch, starPlate } from '../geom/prims';
import { candelabra, column, GOLD, OBS, OBS_DEEP, spire } from '../geom/kit';
import type { ArenaView } from './arenaView';

/** Небольшой архитектурный набор маршрута. Пять дополнительных батчей, без текстур и новых проходов. */
export class GatePathView {
  readonly group = new THREE.Group();
  private readonly seal: THREE.Mesh;
  private readonly way: THREE.Mesh;
  private readonly light: THREE.Mesh;

  constructor(view: ArenaView) {
    const b = new GeomBuilder(); b.rng = new Rng('gate-path:masonry'); b.color = OBS;
    // Галерея: массивные боковые опоры, ближний план и две открытые стрельчатые арки.
    for (const s of [-1, 1]) {
      b.add(box(0.8, 1.3, 15), { matrix: mat(s * 3.5, 0.5, 16.8) });
      b.add(box(0.9, 0.16, 15), { matrix: mat(s * 3.5, 1.23, 16.8), color: GOLD, surface: SURF.metal });
      for (const z of [12, 17, 22]) {
        const p = new GeomBuilder(); p.rng = new Rng(200 + z);
        column(p, { h: 5.7, r: 0.48, sides: 8, seed: 200 + z });
        b.append(p, mat(s * 3.7, 0, z));
        b.add(box(0.65, 4.3, 1.0), { matrix: mat(s * 3.9, 2.1, z) });
        const c = candelabra(b, s * 2.75, z, 1.35, 3, z + (s + 1) * 31);
        view.flames.push(...c.flames);
        view.pools.push({ x: s * 2.75, z, r: 3, color: '#FFB866', intensity: 0.45, flicker: 1 });
      }
      // Низкий парапет за Вратами и рама нового помещения.
      b.add(box(0.7, 1.1, 14), { matrix: mat(s * 3.5, 0.45, -17.5) });
      b.add(box(0.8, 0.12, 14), { matrix: mat(s * 3.5, 1.04, -17.5), color: GOLD, surface: SURF.metal });
      const p = new GeomBuilder(); p.rng = new Rng(271 + s);
      column(p, { h: 8, r: 0.65, sides: 8, seed: 271 + s });
      b.append(p, mat(s * 5.2, 0, -24));
      // Толстая подошва галереи читается над бездной, верх всегда ниже игрового пола.
      b.add(box(1.0, 2.2, 15), { matrix: mat(s * 2.5, -1.6, 16.8), color: OBS_DEEP });
    }
    for (const z of [16.7, 23.5]) b.add(gothicArch(6.3, 4.3, 0.5, 0.8), { matrix: mat(0, 0, z) });
    b.add(gothicArch(7, 4.8, 0.75, 1.2), { matrix: mat(0, 0, -27) });
    // Четыре указателя врезаны в плиты: золото показывает маршрут, не угрозу.
    for (const z of [18, 13, -17, -22]) {
      b.add(starPlate(4, 0.32, 0.12, 0.012), { matrix: mat(0, 0.035, z), color: GOLD, surface: SURF.metal });
      for (const s of [-1, 1]) b.add(box(0.055, 0.02, 2.6), { matrix: mat(s * 1.7, 0.025, z), color: GOLD, surface: SURF.metal });
    }
    const material = obsidianMaterial({ rim: '#3d6688', rimStrength: 0.18, emissive: '#5cc4e0', emissive2: '#FFB866', emissiveStrength: 1.2 });
    const masonry = new THREE.Mesh(b.build(), material);
    this.group.add(masonry);
    view.casters.push(masonry);

    // Средний план: два моста на разных высотах, за ними — компактный силуэт собора.
    const far = new GeomBuilder(); far.rng = new Rng('gate-path:skyline'); far.color = OBS;
    for (const [x, y, z, len] of [[-30, -4, -31, 36], [31, 13, -62, 54]]) {
      far.add(box(len, 1.5, 3), { matrix: mat(x, y, z) });
      for (let i = -2; i <= 2; i++) {
        far.add(gothicArch(5, 12, 0.5, 2), { matrix: mat(x + i * 6, y - 17, z) });
        far.add(box(0.1, 0.15, 2.8), { matrix: mat(x + i * 6, y + 0.9, z), emissive: 0.65, color: GOLD });
      }
    }
    for (const [x, y, z, h] of [[-41, -16, -58, 67], [44, -22, -92, 99], [-19, -30, -93, 79]]) {
      const p = new GeomBuilder(); p.rng = new Rng(Math.abs(x));
      spire(p, { h, r: 3.8, tiers: 4, seed: Math.abs(x) });
      far.append(p, mat(x, y, z));
    }
    this.group.add(new THREE.Mesh(far.build(), material));

    // Печать у входа оставляет центр прозрачным; исчезает после победы.
    this.seal = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec2 vUv; void main(){float k=pow(abs(vUv.x-.5)*2.,6.)*.4+exp(-abs(vUv.y-.12)*110.)*.7; gl_FragColor=vec4(.6,.43,1.,k);}',
    }));
    this.seal.position.set(0, 1.0, 11); this.seal.visible = false;
    this.group.add(this.seal);
    const way = new GeomBuilder(); way.rng = new Rng(282);
    for (const z of [-12, -16, -20, -24]) way.add(starPlate(4, 0.42, 0.15, 0.015), { matrix: mat(0, 0.055, z), emissive: 1, color: GOLD });
    this.way = new THREE.Mesh(way.build(), obsidianMaterial({ emissive: '#FFCC82', emissiveStrength: 1.6 }));
    this.way.visible = false; this.group.add(this.way);
    // Тёплый свет из следующего помещения виден и без экспериментального буфера света.
    this.light = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 13), new THREE.ShaderMaterial({
      uniforms: { uOpen: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform float uOpen; varying vec2 vUv; void main(){float k=pow(max(0.,1.-abs(vUv.x-.5)*2.),1.5)*smoothstep(0.,.5,vUv.y)*.16*uOpen; gl_FragColor=vec4(1.,.64,.24,k);}',
    }));
    this.light.rotation.x = -Math.PI / 2; this.light.position.set(0, 0.045, -17.5);
    this.group.add(this.light);
    view.root.add(this.group);
  }

  update(open: number, combat: boolean): void {
    this.seal.visible = combat;
    this.way.visible = open >= 1;
    (this.light.material as THREE.ShaderMaterial).uniforms.uOpen.value = open;
  }
}
