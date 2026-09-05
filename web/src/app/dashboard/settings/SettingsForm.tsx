"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";

export default function SettingsForm({
  orgId,
  initialName,
  slug,
}: {
  orgId: string;
  initialName: string;
  slug?: string;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const { updateOrgName } = useOrg();

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/updateOrg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId, name: name.trim() }),
      });
      if (res.ok) {
        updateOrgName(orgId, name.trim());
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        router.refresh();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-[#A89584] mb-1">Organization Name</label>
        <input 
          type="text" 
          className="w-full bg-[#1C1510] border border-[#3A2E24] rounded-lg px-3 py-2 text-sm text-[#FFE5C0] focus:outline-none focus:border-[#CD8309] transition-colors" 
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs text-[#A89584] mb-1">Support Email</label>
        <input 
          type="email" 
          className="w-full bg-[#1C1510] border border-[#3A2E24] rounded-lg px-3 py-2 text-sm text-[#FFE5C0] cursor-not-allowed opacity-70" 
          value={`support@${slug || "jerrypay"}.com`} 
          disabled 
          readOnly
        />
      </div>
      <div className="pt-2 flex items-center justify-between">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || name.trim() === initialName}
          className="bg-[#CD8309] text-[#0E0B08] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#FFC97A] transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
        {saved && (
          <span className="text-emerald-500 text-sm flex items-center gap-1 font-medium fade-in">
            <CheckCircle2 className="w-4 h-4" /> Saved!
          </span>
        )}
      </div>
    </div>
  );
}
