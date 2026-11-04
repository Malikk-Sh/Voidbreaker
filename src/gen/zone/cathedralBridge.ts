import * as THREE from 'three';
import { ARENAS } from '../../data/arenas';
import { Arena } from '../../world/arena';
import { CATHEDRAL } from '../../world/cathedralRoute';
import { buildArenaView, ZONE1_LOOK, type ArenaView } from './arenaView';
import { BridgeCollapseView } from './bridgeCollapse';

/** Декор второго зала в тех же мировых координатах. Пол уже собран общей сеткой. */
export function addCathedralBridge(view: ArenaView, density: number): ArenaView {
  const hall = buildArenaView(new Arena(ARENAS.candles), 'stage:1-4', ZONE1_LOOK, density);
  const floorMaterials = new Set<THREE.Material>();
  for (const mesh of hall.floor) { mesh.removeFromParent(); mesh.dispose(); mesh.geometry.dispose(); floorMaterials.add(mesh.material as THREE.Material); }
  for (const material of floorMaterials) material.dispose();
  hall.floor.length = 0;
  hall.root.position.z = CATHEDRAL.hallZ;
  view.root.add(hall.root);
  view.flames.push(...hall.flames.map(([x,y,z]): [number,number,number] => [x,y,z+CATHEDRAL.hallZ]));
  view.pools.push(...hall.pools.map(p => ({ ...p, z: p.z+CATHEDRAL.hallZ })));
  view.rays.push(...hall.rays.map(r => ({ ...r, top: r.top.clone().add(new THREE.Vector3(0,0,CATHEDRAL.hallZ)), bot: r.bot.clone().add(new THREE.Vector3(0,0,CATHEDRAL.hallZ)) })));
  view.casters.push(...hall.casters);
  const collapse = new BridgeCollapseView(view);
  view.root.userData.bridgeCollapse = collapse;
  view.root.updateMatrixWorld(true);
  const update=view.update.bind(view), tint=view.tintGlass.bind(view), light=view.lightConstellations.bind(view);
  view.update=(dt)=>{update(dt);hall.update(dt);};
  view.tintGlass=(k,p)=>{tint(k,p);hall.tintGlass(k,p);};
  view.lightConstellations=()=>{light();hall.lightConstellations();};
  const dispose = view.dispose.bind(view);
  view.dispose=()=>{collapse.dispose();dispose();};
  return hall;
}
