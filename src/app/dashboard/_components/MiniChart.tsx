/**
 * 이미 숫자인 필드의 추이. **점만 찍는다 — 점 사이를 선으로 잇지 않는다.**
 * 없는 날의 값을 선으로 이으면 그 구간에 값이 있었던 것처럼 보인다(추세 착시). 기록이 있는
 * 시점만 정직하게 찍는다. (사용자 지시 [2], CLAUDE.md 원칙 6)
 * 순수 SVG — 차트 라이브러리를 쓰지 않는다.
 */
export interface ChartPoint {
  t: number; // occurred_at (ms)
  y: number; // 원래 값
}

const W = 300;
const H = 76;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 8;

export default function MiniChart({
  points,
  tStart,
  tEnd,
  yMin,
  yMax,
  yTop,
  yBottom,
}: {
  points: ChartPoint[];
  tStart: number;
  tEnd: number;
  yMin: number;
  yMax: number;
  yTop: string; // 위쪽(yMax) 눈금 라벨
  yBottom: string; // 아래쪽(yMin) 눈금 라벨
}) {
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const tSpan = Math.max(1, tEnd - tStart);
  const ySpan = Math.max(1e-9, yMax - yMin);

  const cx = (t: number) => PAD_L + ((t - tStart) / tSpan) * innerW;
  const cy = (y: number) => PAD_T + (1 - (y - yMin) / ySpan) * innerH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="추이(점)">
      {/* 상·하한 기준선 */}
      <line x1={PAD_L} y1={PAD_T} x2={W - PAD_R} y2={PAD_T} stroke="#f3f4f6" strokeWidth={1} />
      <line
        x1={PAD_L}
        y1={H - PAD_B}
        x2={W - PAD_R}
        y2={H - PAD_B}
        stroke="#f3f4f6"
        strokeWidth={1}
      />
      {/* 눈금 라벨 */}
      <text x={PAD_L} y={PAD_T - 1} fontSize={8} fill="#9ca3af">
        {yTop}
      </text>
      <text x={PAD_L} y={H - 1} fontSize={8} fill="#9ca3af">
        {yBottom}
      </text>
      {/* 데이터 점 — 선으로 잇지 않는다 */}
      {points.map((p, i) => (
        <circle key={i} cx={cx(p.t)} cy={cy(p.y)} r={2.6} fill="#374151" />
      ))}
    </svg>
  );
}
