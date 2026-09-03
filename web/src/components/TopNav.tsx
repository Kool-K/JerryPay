"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap, Activity, Sliders } from "lucide-react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Workflows", icon: <Zap className="w-4 h-4" /> },
  { href: "/dashboard/runs", label: "Runs", icon: <Activity className="w-4 h-4" /> },
  { href: "/dashboard/settings", label: "Workspace Settings", icon: <Sliders className="w-4 h-4" /> },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center overflow-x-auto no-scrollbar gap-2 pb-1 sm:pb-0 bg-[#120E0A] border border-[#3A2E24] p-1 rounded-xl shadow-sm">
      <span className="px-3 py-1 text-sm font-bold text-[#CD8309] tracking-wide shrink-0 select-none">
        JerryPay
      </span>
      <span className="w-px h-4 bg-[#3A2E24] shrink-0" />
      {NAV_LINKS.map((link) => {
        const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
        return (
          <Link
            key={link.label}
            href={link.href}
            className={`relative flex items-center justify-center px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              isActive
                ? "bg-[#2A1F18] text-[#CD8309]"
                : "text-[#A89584] hover:bg-[#1C1510] hover:text-[#FFE5C0]"
            }`}
          >
            <span className="shrink-0">{link.icon}</span>
            <span className="ml-2 truncate">{link.label}</span>
            {isActive && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-[2px] bg-[#CD8309] rounded-t-full shadow-[0_0_8px_rgba(205,131,9,0.6)]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
