"use client";

import { useState } from "react";
import { useOrg } from "@/contexts/OrgContext";
import { type OrgId } from "@/lib/orgs";
import { Check, ChevronUp, ChevronDown } from "lucide-react";

export default function OrgSwitcher({ liveOrgName }: { liveOrgName?: string }) {
  const { org, orgId, orgs, switchOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const displayName = liveOrgName || org.name;

  const colorMap: Record<string, string> = {
    indigo:  "bg-[#CD8309]",
    emerald: "bg-emerald-600",
  };

  const badgeColor = colorMap[org.color] ?? "bg-[#CD8309]";

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        id="org-switcher-btn"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[#2A1F18] transition-colors text-left group"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {/* Avatar */}
        <div
          className={`w-7 h-7 rounded-full ${badgeColor} flex items-center justify-center text-white text-xs font-bold shrink-0`}
        >
          {org.letter}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[#FFE5C0] truncate">{displayName}</p>
          <p className="text-[10px] text-[#A89584]">Active workspace</p>
        </div>

        {/* chevron */}
        <span className="text-[#A89584] text-xs group-hover:text-[#FFE5C0] transition-colors">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute bottom-full mb-2 left-0 right-0 bg-[#1C1510] border border-[#3A2E24] rounded-xl shadow-2xl overflow-hidden z-50"
          role="listbox"
          aria-label="Switch organization"
        >
          {orgs.map((o) => (
            <button
              key={o.id}
              role="option"
              aria-selected={o.id === orgId}
              onClick={() => {
                setOpen(false);
                if (o.id !== orgId) switchOrg(o.id as OrgId);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#2A1F18] transition-colors"
            >
              <div
                className={`w-6 h-6 rounded-full ${colorMap[o.color] ?? "bg-[#CD8309]"} flex items-center justify-center text-[#0E0B08] text-[10px] font-bold shrink-0`}
              >
                {o.letter}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[#FFE5C0] truncate">
                  {o.id === orgId ? displayName : o.name}
                </p>
              </div>
              {o.id === orgId && (
                <span className="text-[#CD8309]"><Check className="w-4 h-4" /></span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Backdrop to close */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
