import { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function QRModal({ queueId, queueName, onClose }) {
  const joinUrl = `${window.location.origin}/queue/${queueId}/join`;
  const qrRef = useRef();

  const handleDownload = () => {
    const svgElement = qrRef.current.querySelector('svg');
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Scale up for better quality
    const scale = 5;
    const width = svgElement.clientWidth * scale;
    const height = svgElement.clientHeight * scale;
    
    canvas.width = width;
    canvas.height = height;

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const pngFile = canvas.toDataURL('image/png');
      
      const downloadLink = document.createElement('a');
      downloadLink.download = `${queueId}_qr_code.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div
        className="w-full max-w-md relative overflow-hidden rounded-3xl animate-scale-in p-8"
        style={{
          background: '#ffffff',
          boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
          border: '1px solid #e8ecf2',
        }}
        onClick={(e) => e.stopPropagation()}>

        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-300 hover:bg-gray-100"
          style={{ color: '#94a3b8' }}
        >
          ✕
        </button>

        <div className="text-center mb-6">
          <h2 style={{ color: '#1a1a2e', fontFamily: "'Inter', sans-serif" }} className="text-xl font-bold">Queue QR Code</h2>
          <p className="text-sm mt-1.5" style={{ color: '#64748b' }}>Students scan this to join instantly</p>
        </div>

        <div className="flex flex-col items-center">
          {/* QR Code with navy/accent gradient border */}
          <div className="p-1 rounded-2xl mb-6" style={{
            background: 'linear-gradient(135deg, #1a3c8f, #00c896)',
          }}>
            <div className="bg-white p-5 rounded-[14px]" ref={qrRef}>
              <QRCodeSVG 
                value={joinUrl}
                size={200}
                level="H"
                fgColor="#1a1a2e"
                includeMargin={true}
                imageSettings={{
                  src: "https://api.dicebear.com/7.x/identicon/svg?seed=iq",
                  x: undefined,
                  y: undefined,
                  height: 44,
                  width: 44,
                  excavate: true,
                }}
              />
            </div>
          </div>

          <div className="w-full space-y-3">
            {/* Queue name display */}
            <div className="rounded-xl p-3.5 flex items-center justify-between"
              style={{ background: '#f4f6fa', border: '1px solid #e8ecf2' }}>
              <span className="text-[10px] uppercase font-bold tracking-widest" style={{ color: '#64748b' }}>Queue</span>
              <span className="font-mono font-bold" style={{ color: '#1a3c8f' }}>{queueName}</span>
            </div>

            <button 
              onClick={handleDownload}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3.5"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              Download PNG
            </button>

            <button 
              onClick={() => {
                navigator.clipboard.writeText(joinUrl);
              }}
              className="btn-outline w-full flex items-center justify-center gap-2 py-3.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
              </svg>
              Copy Link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
