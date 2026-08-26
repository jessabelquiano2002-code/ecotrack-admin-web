export default function OfflinePage() {
  return (
    <main style={{
      minHeight: "100dvh",
      display: "grid",
      placeItems: "center",
      padding: 24,
      background: "#f4f7f5",
      color: "#0f172a",
      fontFamily: "Arial, sans-serif",
    }}>
      <section style={{
        width: "min(520px, 100%)",
        padding: 28,
        border: "1px solid #dbe9e1",
        borderRadius: 20,
        background: "#ffffff",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📡</div>
        <h1 style={{ margin: "0 0 8px", fontSize: 25 }}>MetroWaste is offline</h1>
        <p style={{ margin: 0, lineHeight: 1.65, color: "#64748b" }}>
          Previously synchronized MetroWaste pages and data remain available on this device.
          Pages or server-only actions that were never cached still require an internet connection.
        </p>
        <a href="/dashboard" style={{
          display: "inline-flex",
          marginTop: 20,
          padding: "11px 16px",
          borderRadius: 10,
          background: "#087a59",
          color: "#ffffff",
          textDecoration: "none",
          fontWeight: 800,
        }}>
          Open cached dashboard
        </a>
      </section>
    </main>
  );
}
