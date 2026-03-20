export default function NetworkQuality({ quality }) {
  if (!quality) return null;

  const colors = {
    excellent: "#22c55e",
    good: "#eab308",
    poor: "#f97316",
    bad: "#ef4444",
  };

  const bars = { excellent: 4, good: 3, poor: 2, bad: 1 };
  const filled = bars[quality.quality] ?? 2;
  const color = colors[quality.quality] ?? "#f97316";

  return (
    <div className="net-quality" title={`RTT: ${quality.rtt}ms | Loss: ${quality.packetLoss}% | ${quality.bitrate}kbps`}>
      <div className="net-bars">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="net-bar"
            style={{
              height: `${6 + i * 4}px`,
              background: i <= filled ? color : "rgba(255,255,255,0.12)",
              transition: "background 0.4s",
            }}
          />
        ))}
      </div>
      <div className="net-label" style={{ color }}>
        {quality.quality}
      </div>
      {quality.rtt !== null && (
        <div className="net-rtt">{quality.rtt}ms</div>
      )}
    </div>
  );
}
