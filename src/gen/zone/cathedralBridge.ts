import * as THREE from 'three';
import { ARENAS } from '../../data/arenas';
import { Arena } from '../../world/arena';
import { CATHEDRAL } from '../../world/cathedralRoute';
import { Rng } from '../../core/rng';
import { GeomBuilder, mat, SURF } from '../geom/build';
import { box, starPlate } from '../geom/prims';
import { candelabra, GOLD, OBS } from '../geom/kit';
import { obsidianMaterial } from '../../render/materials';
import { buildArenaView, ZONE1_LOOK, type ArenaView } from './arenaView';

/** Декор второго зала в тех же мировых координатах. Пол уже собран общей сеткой. */
export function addCathedralBridge(view: ArenaView, density: number): ArenaView {
  const hall = buildArenaView(new Arena(ARENAS.candles), 'stage:1-4', ZONE1_LOOK, density);
  const floorMaterials = new Set<THREE.Material>();
  for (const mesh of hall.floor) { mesh.removeFromParent(); mesh.geometry.dispose(); floorMaterials.add(mesh.material as THREE.Material); }
  for (const material of floorMaterials) material.dispose();
  hall.floor.length = 0;
  hall.root.position.z = CATHEDRAL.hallZ;
  view.root.add(hall.root);
  view.flames.push(...hall.flames.map(([x,y,z]): [number,number,number] => [x,y,z+CATHEDRAL.hallZ]));
  view.pools.push(...hall.pools.map(p => ({ ...p, z: p.z+CATHEDRAL.hallZ })));
  view.rays.push(...hall.rays.map(r => ({ ...r, top: r.top.clone().add(new THREE.Vector3(0,0,CATHEDRAL.hallZ)), bot: r.bot.clone().add(new THREE.Vector3(0,0,CATHEDRAL.hallZ)) })));
  view.casters.push(...hall.casters);
  const g = new GeomBuilder(); g.rng = new Rng('cathedral:bridge'); g.color = OBS;
  for (const side of [-1,1]) {
    g.add(box(0.5,0.75,20), {matrix:mat(side*2.9,0.3,-34)});
    g.add(box(0.58,0.12,20), {matrix:mat(side*2.9,0.74,-34),color:GOLD,surface:SURF.metal});
    for (const z of [-26,-31,-36,-41]) {
      g.add(box(0.75,1.2,0.75), {matrix:mat(side*2.9,0.55,z)});
      const c=candelabra(g,side*2.85,z,1.3,3,Math.abs(z)+side);
      view.flames.push(...c.flames);
      view.pools.push({x:side*2.85,z,r:3,color:'#FFB866',intensity:0.4,flicker:1});
    }
    g.add(box(0.8,1.5,23), {matrix:mat(side*2.3,-1.15,-34)});
  }
  for (const z of [-27,-32,-37,-42]) g.add(starPlate(4,0.28,0.1,0.012), {matrix:mat(0,0.03,z),color:GOLD,surface:SURF.metal});
  const mesh=new THREE.Mesh(g.build(),obsidianMaterial({rim:'#3d6688',rimStrength:0.14,emissive:'#5cc4e0',emissive2:'#FFB866'}));
  view.root.add(mesh); view.casters.push(mesh);
  // Световая кромка запечатанного входа показывает ту же границу, которую читает навигация.
  const seal=new THREE.Mesh(new THREE.PlaneGeometry(5.4,0.08),new THREE.MeshBasicMaterial({color:'#b794ff',transparent:true,opacity:0.7,side:THREE.DoubleSide}));
  seal.position.set(0,0.25,CATHEDRAL.sealZ); seal.visible=false;view.root.add(seal);
  view.root.updateMatrixWorld(true);
  const update=view.update.bind(view), tint=view.tintGlass.bind(view), light=view.lightConstellations.bind(view);
  view.update=(dt)=>{update(dt);hall.update(dt);seal.visible=view.root.userData.candleCombat===true;};
  view.tintGlass=(k,p)=>{tint(k,p);hall.tintGlass(k,p);};
  view.lightConstellations=()=>{light();hall.lightConstellations();};
  return hall;
}
