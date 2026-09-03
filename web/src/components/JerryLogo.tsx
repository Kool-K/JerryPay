import React from 'react';

/**
 * JerryPay Logo Mark
 * Golden shield with lightning zap + ₹ accent — signals agentic commerce.
 * Component name kept as JerryLogo for backward-compatible imports.
 */
export function JerryLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Espresso Shield Background */}
      <rect width="100" height="100" rx="22" fill="#1C1510" stroke="#3A2E24" strokeWidth="3" />

      {/* Inner glow ring */}
      <rect x="6" y="6" width="88" height="88" rx="18"
        fill="none" stroke="#CD8309" strokeWidth="1" strokeOpacity="0.25" />

      {/* Shield body */}
      <path
        d="M50 12 L82 26 L82 52 C82 68 66 82 50 88 C34 82 18 68 18 52 L18 26 Z"
        fill="#CD8309"
        fillOpacity="0.18"
        stroke="#CD8309"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Lightning Zap — agentic workflow symbol */}
      <path
        d="M54 22L36 52H50L44 78L66 46H52L54 22Z"
        fill="#FFE5C0"
        stroke="#120E0A"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* ₹ accent — commerce mark, bottom-right */}
      <text
        x="62"
        y="80"
        fontSize="18"
        fontWeight="700"
        fill="#CD8309"
        fontFamily="system-ui, sans-serif"
        textAnchor="middle"
      >
        ₹
      </text>
    </svg>
  );
}
