import { FONT_BODY } from './fonts';

export interface HeartBarState { hp: number; maxHp: number; phase: number }

/** Только состояние противника: правила боя видны в мире, а не в текстовой памятке. */
export function drawHeartBar(g: CanvasRenderingContext2D, state: HeartBarState, x: number, y: number, s: number): void {
  const w=282*s,h=7*s,frac=Math.max(0,Math.min(1,state.hp/state.maxHp));
  g.save();g.textAlign='center';g.textBaseline='middle';
  g.fillStyle='#e7c58b';g.font=`600 ${Math.max(10,12*s)}px ${FONT_BODY}`;
  g.fillText('НЕУГАСИМОЕ СЕРДЦЕ',x,y+10*s);
  g.fillStyle='rgba(10,5,12,0.9)';g.fillRect(x-w/2,y+24*s,w,h);
  g.fillStyle=state.phase===3?'#f38272':'#b83f56';g.fillRect(x-w/2,y+24*s,w*frac,h);
  g.strokeStyle='#ab8c57';g.lineWidth=s;g.strokeRect(x-w/2,y+24*s,w,h);
  for(const k of [1/3,2/3]){g.beginPath();g.moveTo(x-w/2+w*k,y+23*s);g.lineTo(x-w/2+w*k,y+32*s);g.stroke();}
  for(let i=0;i<3;i++){
    g.fillStyle=i<state.phase?'#e7c58b':'#403442';g.save();g.translate(x+(i-1)*11*s,y+39*s);g.rotate(Math.PI/4);g.fillRect(-2*s,-2*s,4*s,4*s);g.restore();
  }
  g.restore();
}
