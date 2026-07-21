export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="kicker">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
