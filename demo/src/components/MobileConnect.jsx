import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { isLocalhost, isMobile, mobileAcquireUrl } from "../lib/device.js";

export default function MobileConnect() {
  const [copied, setCopied] = useState(false);
  const url = mobileAcquireUrl();

  // Already on phone via LAN, or no URL configured — nothing to show.
  if (isMobile() || !isLocalhost() || !url) return null;

  const acquireUrl = `${url.replace(/\/$/, "")}/?tab=acquire`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(acquireUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="card mobile-connect">
      <div className="mobile-connect-inner">
        <div className="mobile-connect-qr">
          <QRCodeSVG value={acquireUrl} size={128} bgColor="#111827" fgColor="#d4a853" level="M" />
        </div>
        <div className="mobile-connect-body">
          <p className="card-title">Use your iPhone</p>
          <p className="mobile-connect-steps">
            Same Wi‑Fi as this PC → scan QR with Camera → open in Safari →{" "}
            <strong>Acquire</strong> tab → Photo Library (photos + clips), Take Photo, or Record Clip.
          </p>
          <code className="mobile-connect-url">{acquireUrl}</code>
          <div className="mobile-connect-actions">
            <button type="button" className="btn btn-primary" onClick={copy}>
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
          <p className="mobile-connect-hint">
            Run <code>start_demo_mobile.bat</code> if this panel is missing. Allow Windows Firewall
            for port 5174 on first prompt.
          </p>
        </div>
      </div>
    </div>
  );
}
