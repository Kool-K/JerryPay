"use client";

import { useState } from "react";
import { useOrg, USERS, type UserId } from "@/contexts/OrgContext";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export default function UserSwitcher() {
  const { user, userId, switchUser } = useOrg();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 hover:bg-[#1C1510] px-2 py-1.5 rounded-lg transition-colors group"
      >
        <span className="text-xs font-medium text-[#A89584] bg-[#1C1510] px-2 py-1 rounded-full border border-[#3A2E24] capitalize">
          {user.role}
        </span>
        <div className="relative w-8 h-8 rounded-full bg-[#1C1510] border border-[#3A2E24] flex items-center justify-center text-xs text-[#FFE5C0] font-semibold">
          {user.initials}
          <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-[#0E0B08]"></span>
        </div>
        <span className="text-[#A89584] group-hover:text-[#FFE5C0]">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-[#1C1510] border border-[#3A2E24] rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-[#3A2E24]">
            <p className="text-[10px] font-semibold text-[#A89584] uppercase tracking-wider">Act As</p>
          </div>
          {USERS.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                switchUser(u.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#2A1F18] transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-[#2A1F18] border border-[#3A2E24] flex items-center justify-center text-xs text-[#FFE5C0] font-semibold shrink-0">
                {u.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[#FFE5C0] truncate">{u.name}</p>
                <p className="text-[10px] text-[#A89584] capitalize">{u.role}</p>
              </div>
              {u.id === userId && <Check className="w-4 h-4 text-[#CD8309]" />}
            </button>
          ))}
        </div>
      )}

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
}
