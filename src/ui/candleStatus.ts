import { FONT_BODY, FONT_TECH } from './fonts';

export interface CandleStatus {
  lit: readonly boolean[];
  carried: number;
  broken: boolean;
  warning: number;
  chargingIndex: number;
  charge: number;
}

/** Небольшая цель локации: счётчики и одна строка действия, без баннера поверх боя. */
export function drawCandleStatus(g: CanvasRenderingContext2D, state: CandleStatus, x: number, y: number, s: number): void {
  const width=186*s, height=35*s, count=state.lit.filter(Boolean).length;
  g.save();
  g.fillStyle='rgba(7,6,11,0.65)';g.fillRect(x-width/2,y,width,height);
  g.strokeStyle=state.warning>0?'#cf6266':'#756342';g.lineWidth=0.7*s;
  g.beginPath();g.moveTo(x-width/2,y);g.lineTo(x+width/2,y);g.stroke();
  g.textAlign='center';g.textBaseline='middle';
  g.font=`600 ${Math.max(10,10*s)}px ${FONT_TECH}`;
  g.fillStyle=state.broken?'#ffdca0':'#e1c58e';
  g.fillText(state.broken?'СЕРДЦЕ ОСВОБОЖДЕНО':`ОГНИ ${count}/3  ·  ИСКРЫ ${state.carried}`,x,y+10*s);
  if(!state.broken){
    g.font=`${Math.max(9,9*s)}px ${FONT_BODY}`;
    g.fillStyle=state.warning>0?'#ff9b9b':'#c2bbb0';
    const line=state.warning>0?'Импульс — укройся в свете':state.chargingIndex>=0?'Возвращение огня…':state.carried>0?'Искра → тёмная жаровня':'Побеждай врагов, собирай искры';
    g.fillText(line,x,y+25*s);
    if(state.chargingIndex>=0){g.fillStyle='#ffdca0';g.fillRect(x-width/2,y+height-2*s,width*state.charge,2*s);}
  }
  g.restore();
}
