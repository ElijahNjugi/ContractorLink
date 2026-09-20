import { useEffect, useState } from "react";

function getTiming(startTime, endTime, status, now) {
  if (status === "BREACHED") return { tone: "breached", label: "Breached", detail: "SLA target exceeded", progress: 100 };
  if (!startTime || !endTime) return { tone: "neutral", label: "SLA active", detail: "Timer unavailable", progress: 0 };
  const start = new Date(startTime).getTime(); const end = new Date(endTime).getTime();
  const total = Math.max(1, end - start); const left = end - now;
  if (left <= 0) return { tone: "breached", label: "Breached", detail: "SLA target reached", progress: 100 };
  const leftMinutes = Math.ceil(left / 60000); const hours = Math.floor(leftMinutes / 60); const minutes = leftMinutes % 60;
  const progress = Math.min(100, Math.max(0, ((now - start) / total) * 100));
  const ratioLeft = left / total;
  return { tone: ratioLeft <= .2 ? "warning" : "healthy", label: ratioLeft <= .2 ? "Time almost up" : "On track", detail: `${hours ? `${hours}h ` : ""}${minutes}m remaining`, progress };
}

export default function SlaClock({ startTime, endTime, status, compact = false }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(id); }, []);
  if (["COMPLETED", "CANCELLED"].includes(String(status || "").toUpperCase())) return null;
  const timing = getTiming(startTime, endTime, status, now);
  return <div className={`sla-clock ${timing.tone} ${compact ? "compact" : ""}`}>
    <div className="sla-clock-head"><span className="sla-clock-dot" /><strong>{timing.label}</strong><span>{timing.detail}</span></div>
    <div className="sla-clock-track"><span style={{ width: `${timing.progress}%` }} /></div>
  </div>;
}
