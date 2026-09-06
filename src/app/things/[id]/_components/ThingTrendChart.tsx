/**
 * 날짜별 사용 횟수 막대 차트. 순수 SVG — 라이브러리 없음.
 * 최근 90일만 그린다 (그 이상이면 막대가 너무 좁다).
 */
const MAX_SHOW = 90;
const W = 600;
const H = 60;
const PAD_B = 14; // 날짜 라벨 공간

export default function ThingTrendChart({
  dailyCounts,
}: {
  dailyCounts: { date: string; count: number }[];
}) {
  const visible = dailyCounts.slice(-MAX_SHOW);
  if (visible.length === 0) return null;

  const maxCount = Math.max(...visible.map((d) => d.count), 1);
  const barW = (W / visible.length) * 0.7;
  const gap = W / visible.length;
  const innerH = H - PAD_B;

  // 월 첫째 날 눈금 (최대 6개)
  const monthTicks: { x: number; label: string }[] = [];
  for (let i = 0; i < visible.length; i++) {
    const { date } = visible[i]!;
    if (date.slice(8) === "01") {
      const x = i * gap + gap / 2;
      monthTicks.push({ x, label: `${parseInt(date.slice(5, 7))}월` });
    }
  }
  // 최대 6개만 (너무 빽빽하면 겹침)
  const shownTicks = monthTicks.slice(-6);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="날짜별 사용 횟수"
    >
      {/* 기준선 */}
      <line x1={0} y1={innerH} x2={W} y2={innerH} stroke="#f3f4f6" strokeWidth={1} />

      {/* 막대 */}
      {visible.map(({ date, count }, i) => {
        if (count === 0) return null;
        const x = i * gap + (gap - barW) / 2;
        const barH = Math.max(2, (count / maxCount) * innerH);
        const y = innerH - barH;
        const fill = count >= 2 ? "#1f2937" : "#9ca3af";
        return <rect key={date} x={x} y={y} width={barW} height={barH} fill={fill} rx={1} />;
      })}

      {/* 월 눈금 라벨 */}
      {shownTicks.map(({ x, label }) => (
        <text key={label} x={x} y={H} fontSize={8} fill="#9ca3af" textAnchor="middle">
          {label}
        </text>
      ))}
    </svg>
  );
}
