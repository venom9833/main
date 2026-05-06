export default function GlossaryPage() {
  return (
    <main style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #07080f 0%, #0d1117 100%)',
      paddingTop: 112,
      paddingBottom: 80,
      paddingLeft: '2rem',
      paddingRight: '2rem',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* 헤더 */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{
            fontSize: '1.75rem',
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '-0.5px',
            margin: 0,
          }}>
            용어집
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', marginTop: 8, fontSize: '0.9rem' }}>
            AI·영상·비즈니스 주요 용어 정리
          </p>
        </div>

        {/* 준비 중 안내 */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: '60px 40px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>📖</div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.95rem', margin: 0 }}>
            용어집 준비 중입니다.
          </p>
        </div>

      </div>
    </main>
  );
}
