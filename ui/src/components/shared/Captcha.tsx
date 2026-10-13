/*
 * Anti-Bot Security Check CAPTCHA Component.
 * Ported directly from binary_alive (src/server/lib/captcha.ts & src/pages/Login.tsx).
 * Features:
 *  - Anti-OCR SVG generation with curves, noise circles, randomized fonts, rotations, skew, and strikes.
 *  - 140x46px preview card with 1.6x smooth hover-scale magnification and click-to-reload.
 *  - 5-cell discrete input field with auto-advance, backspace navigation, arrow key support, and clipboard paste.
 *  - Emerald / Red / Default dynamic validation states.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';

export interface CaptchaRef {
  refresh: () => void;
  validate: () => boolean;
  reset: () => void;
  shake: () => void;
  isVerified: boolean;
}

export interface CaptchaProps {
  onVerifyChange?: (isValid: boolean) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Advanced anti-OCR SVG generator from binary_alive/src/server/lib/captcha.ts.
 * Excludes confusing chars (0, O, 1, I).
 */
function generateCaptchaSvg(): { text: string; svgUrl: string } {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let text = '';
  for (let i = 0; i < 5; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const width = 160;
  const height = 48;

  // Background noise patterns (circles)
  let dots = '';
  for (let i = 0; i < 55; i++) {
    const cx = Math.random() * width;
    const cy = Math.random() * height;
    const r = Math.random() * 2.2 + 0.5;
    const color = `rgba(${Math.floor(Math.random() * 100)}, ${Math.floor(
      Math.random() * 100
    )}, ${Math.floor(Math.random() * 100)}, ${0.25 + Math.random() * 0.25})`;
    dots += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" />`;
  }

  // Cross-hatch background lines (defeats Otsu thresholding / binarization in OCR)
  let gridLines = '';
  for (let x = -height; x < width + height; x += 15) {
    gridLines += `<line x1="${x}" y1="0" x2="${x + height}" y2="${height}" stroke="rgba(140,140,150,0.22)" stroke-width="1" />`;
  }

  // Background curves
  let curves = '';
  for (let i = 0; i < 12; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const cx = Math.random() * width;
    const cy = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    const strokeW = Math.random() * 1.6 + 0.6;
    const color = `rgba(${Math.floor(Math.random() * 110)}, ${Math.floor(
      Math.random() * 110
    )}, ${Math.floor(Math.random() * 110)}, 0.45)`;
    curves += `<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" stroke="${color}" stroke-width="${strokeW}" fill="none" />`;
  }

  // Character distortion: wavy baseline displacement, heavy rotation, affine skew, and varied kerning
  let textChars = '';
  const fonts = ['Arial', 'Courier New', 'Georgia', 'Verdana', 'Trebuchet MS', 'Impact'];
  const weights = ['bold', '800', '900'];
  const basePhase = Math.random() * Math.PI * 2;

  // Tighter spacing with jitter so characters slightly overlap at edges (defeats glyph segmentation)
  const charSpacing = width / 6.6;
  for (let i = 0; i < text.length; i++) {
    const x = 14 + i * charSpacing + (Math.random() * 6 - 3);
    const y = 32 + Math.sin(i * 1.4 + basePhase) * 6 + (Math.random() * 6 - 3);

    const rot = Math.floor(Math.random() * 48 - 24); // -24 to +24 deg rotation
    const skewX = Math.floor(Math.random() * 34 - 17); // -17 to +17 deg skew
    const scaleY = 0.85 + Math.random() * 0.35;
    const scaleX = 0.88 + Math.random() * 0.28;

    const r = Math.floor(Math.random() * 55);
    const g = Math.floor(Math.random() * 55);
    const b = Math.floor(Math.random() * 55);

    const font = fonts[Math.floor(Math.random() * fonts.length)];
    const weight = weights[Math.floor(Math.random() * weights.length)];
    const fontSize = 28 + Math.floor(Math.random() * 5 - 2);

    textChars += `<text x="0" y="0" font-family="${font}, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="rgb(${r},${g},${b})" stroke="rgb(${r},${g},${b})" stroke-width="0.5" transform="translate(${x}, ${y}) rotate(${rot}) skewX(${skewX}) scale(${scaleX}, ${scaleY})">${text[i]}</text>`;
  }

  // Foreground strike-through curves & lines slicing across glyphs
  let strikes = '';
  // Wavy bezier strike lines
  for (let i = 0; i < 2; i++) {
    const y1 = 16 + Math.random() * 16;
    const cx = width * 0.5 + (Math.random() * 30 - 15);
    const cy = 16 + Math.random() * 16;
    const y2 = 16 + Math.random() * 16;
    const strokeW = Math.random() * 1.5 + 0.8;
    const r = Math.floor(Math.random() * 70);
    strikes += `<path d="M 0 ${y1} Q ${cx} ${cy} ${width} ${y2}" stroke="rgb(${r},${r},${r})" stroke-width="${strokeW}" fill="none" opacity="0.65" />`;
  }
  // Straight diagonal strike lines
  for (let i = 0; i < 2; i++) {
    const y = 20 + Math.random() * 12;
    const r = Math.floor(Math.random() * 70);
    const strokeW = Math.random() * 1.3 + 0.6;
    strikes += `<line x1="0" y1="${y + Math.random() * 6 - 3}" x2="${width}" y2="${y + Math.random() * 6 - 3}" stroke="rgb(${r},${r},${r})" stroke-width="${strokeW}" opacity="0.6" />`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#c8cdd3" rx="6" />${gridLines}${dots}${curves}${textChars}${strikes}</svg>`;
  const svgUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  return { text, svgUrl };
}

export const Captcha = forwardRef<CaptchaRef, CaptchaProps>(function Captcha(
  { onVerifyChange, className = '', disabled = false },
  ref
) {
  const [captchaData, setCaptchaData] = useState<{ text: string; svgUrl: string }>(() =>
    generateCaptchaSvg()
  );
  const [captchaInput, setCaptchaInput] = useState<string>('');
  const [captchaValid, setCaptchaValid] = useState<boolean | null>(null);
  const captchaRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ─── Re-verification on input changes ───────────────────────────────────────

  useEffect(() => {
    if (captchaInput.length === 5) {
      const isValid = captchaInput.toUpperCase() === captchaData.text.toUpperCase();
      setCaptchaValid(isValid);
      onVerifyChange?.(isValid);
    } else {
      setCaptchaValid(null);
      onVerifyChange?.(false);
    }
  }, [captchaInput, captchaData, onVerifyChange]);

  const reloadCaptcha = useCallback(() => {
    const next = generateCaptchaSvg();
    setCaptchaData(next);
    setCaptchaInput('');
    setCaptchaValid(null);
    onVerifyChange?.(false);
    captchaRefs.current[0]?.focus();
  }, [onVerifyChange]);

  const validate = useCallback((): boolean => {
    const isValid = captchaInput.trim().toUpperCase() === captchaData.text.toUpperCase();
    setCaptchaValid(isValid);
    onVerifyChange?.(isValid);
    if (!isValid) {
      captchaRefs.current[0]?.focus();
    }
    return isValid;
  }, [captchaInput, captchaData, onVerifyChange]);

  useImperativeHandle(ref, () => ({
    refresh: reloadCaptcha,
    validate,
    reset: reloadCaptcha,
    shake: () => {
      setCaptchaValid(false);
      captchaRefs.current[0]?.focus();
    },
    isVerified: captchaValid === true,
  }));

  return (
    <div className={`mt-1 flex flex-col gap-2 select-none ${className}`}>
      <label className="text-[13px] font-medium text-[#cccccc] tracking-tight">
        Security Check
      </label>
      <div className="flex items-center gap-3 relative">
        {/* Clickable CAPTCHA Image with 1.6x hover zoom from binary_alive */}
        <div
          className="group h-[46px] w-[140px] rounded-[8px] border border-[#2a2a2a] shrink-0 relative z-10 hover:z-50 cursor-pointer"
          onClick={reloadCaptcha}
          title="Click to reload CAPTCHA"
        >
          <img
            src={captchaData.svgUrl}
            alt="CAPTCHA"
            className="w-full h-full object-cover rounded-[8px] transition-all duration-300 ease-out origin-left shadow-sm group-hover:scale-[1.6] group-hover:shadow-[0_8px_30px_rgb(0,0,0,0.8)] group-hover:-translate-y-2"
          />
        </div>

        {/* 5 Distinct Input Containers from binary_alive */}
        <div className="inline-flex items-center gap-1.5 flex-1">
          {[0, 1, 2, 3, 4].map((index) => {
            const char = captchaInput[index] || '';

            let stateClasses =
              'border border-[#262626] bg-[#0B0B0C] text-white focus:border-[#2f80ed] focus:ring-[1.5px] focus:ring-[#2f80ed]/50';
            if (captchaValid === true) {
              stateClasses =
                'border border-emerald-500 bg-[#0B0B0C] text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)] focus:border-emerald-500 focus:ring-emerald-500/50';
            } else if (captchaValid === false) {
              stateClasses =
                'border border-red-500 bg-[#0B0B0C] text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.15)] focus:border-red-500 focus:ring-red-500/50';
            }

            return (
              <input
                key={index}
                ref={(el) => (captchaRefs.current[index] = el)}
                type="text"
                disabled={disabled}
                maxLength={2}
                value={char}
                onPaste={(e) => {
                  e.preventDefault();
                  const pasted = e.clipboardData
                    .getData('text')
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 5);
                  if (pasted) {
                    setCaptchaInput(pasted);
                    captchaRefs.current[Math.min(pasted.length, 4)]?.focus();
                  }
                }}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                  const lastChar = val.slice(-1);
                  const newArr = captchaInput.padEnd(5, ' ').split('');
                  newArr[index] = lastChar || ' ';
                  const newStr = newArr.join('').trimEnd();
                  setCaptchaInput(newStr);
                  if (lastChar && index < 4) captchaRefs.current[index + 1]?.focus();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !char && index > 0) {
                    captchaRefs.current[index - 1]?.focus();
                  } else if (e.key === 'ArrowLeft' && index > 0) {
                    e.preventDefault();
                    captchaRefs.current[index - 1]?.focus();
                  } else if (e.key === 'ArrowRight' && index < 4) {
                    e.preventDefault();
                    captchaRefs.current[index + 1]?.focus();
                  }
                }}
                autoComplete="off"
                className={`w-full min-w-0 h-[46px] rounded-[8px] text-center font-['JetBrains_Mono',monospace] text-[16px] font-semibold transition-all duration-200 outline-none caret-[#2f80ed] ${stateClasses}`}
                required={index === 0}
                aria-label={`Security code character ${index + 1}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});
