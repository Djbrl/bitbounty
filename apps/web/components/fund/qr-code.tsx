import { encodeQr, qrPath } from "./qr";
import { cx } from "../ui";

export interface QrCodeProps {
  value: string;
  /** Accessible label ("Lightning invoice QR code"). */
  label: string;
  className?: string;
}

/**
 * QR code as an inline SVG, generated in the browser/server with ./qr.ts (no dependency).
 * Always black on white, also in dark mode: wallet scanners expect dark modules on a light field.
 */
export function QrCode({ value, label, className }: QrCodeProps) {
  const m = encodeQr(value, "M");
  const quiet = 2; // the white card padding adds the rest of the quiet zone
  const n = m.length + quiet * 2;
  return (
    <div className={cx("aspect-square w-full max-w-[200px] rounded-[10px] border border-rule bg-white p-2.5", className)}>
      <svg
        viewBox={`0 0 ${n} ${n}`}
        role="img"
        aria-label={label}
        shapeRendering="crispEdges"
        className="block size-full"
        data-qr-size={m.length}
      >
        <rect width={n} height={n} fill="#fff" />
        <path d={qrPath(m, quiet)} fill="#000" />
      </svg>
    </div>
  );
}
