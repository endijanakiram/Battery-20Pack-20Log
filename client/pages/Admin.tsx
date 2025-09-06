import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";

interface PackDoc {
  pack_serial: string;
  created_at: string;
  created_by: string | null;
  modules: Record<string, string[]>;
  codes: { module1: string; module2: string; master: string };
}

export default function Admin() {
  const nav = useNavigate();
  const [packs, setPacks] = useState<PackDoc[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [model, setModel] = useState<"LFP6" | "LFP9">("LFP9");
  const [batch, setBatch] = useState("001");
  const [nextSerial, setNextSerial] = useState("");

  useEffect(() => {
    if (localStorage.getItem("auth_role") !== "admin") {
      nav("/");
      return;
    }
    load();
    loadConfig();
    previewNext();
  }, []);

  async function load() {
    const res = await fetch("/api/packs");
    const j = await res.json();
    const list: PackDoc[] = j.packs || [];
    setPacks(list);
    if (list.length && !selected) setSelected(list[0].pack_serial);
  }

  async function loadConfig() {
    const res = await fetch("/api/config");
    if (res.ok) {
      const j = await res.json();
      setModel(j.model);
      setBatch(j.batch);
    }
  }

  async function saveConfig() {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, batch }),
    });
    if (res.ok) previewNext();
  }

  async function previewNext() {
    const r = await fetch("/api/next-pack-serial");
    if (r.ok) {
      const j = await r.json();
      setNextSerial(j.next);
    }
  }

  const total = useMemo(() => packs.length, [packs]);
  const current = useMemo(
    () => packs.find((p) => p.pack_serial === selected) || null,
    [packs, selected],
  );

  useEffect(() => {
    if (current) {
      const map: Record<string, string> = {};
      for (const [mid, cells] of Object.entries(current.modules)) {
        map[mid] = cells.join("\n");
      }
      setEditing(map);
    }
  }, [current?.pack_serial]);

  async function saveEdits() {
    if (!current) return;
    const modules: Record<string, string[]> = {};
    for (const [mid, text] of Object.entries(editing)) {
      modules[mid] = text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const res = await fetch(
      `/api/packs/${encodeURIComponent(current.pack_serial)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules }),
      },
    );
    if (res.ok) load();
  }

  async function deletePack() {
    if (!current) return;
    if (!confirm(`Delete pack ${current.pack_serial}?`)) return;
    const res = await fetch(
      `/api/packs/${encodeURIComponent(current.pack_serial)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      await load();
      setSelected("");
    }
  }

  function downloadImage(url: string) {
    fetch(url)
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = url.split("/").pop() || "code.png";
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  function printImage(url: string) {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      `<html><head><title>Print</title></head><body style="margin:0"><img src="${url}" onload="window.print();window.close();" /></body></html>`,
    );
    w.document.close();
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b bg-white px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-emerald-700">Admin</h1>
          <p className="text-xs text-slate-500">Total packs: {total}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              localStorage.removeItem("auth_role");
              nav("/");
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 md:grid-cols-12 gap-6">
        <aside className="md:col-span-4 space-y-4">
          <div className="border rounded p-3 bg-slate-50">
            <h3 className="font-semibold mb-2">Config</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Model</label>
                <select
                  className="mt-1 w-full border rounded px-2 py-2"
                  value={model}
                  onChange={(e) => setModel(e.target.value as any)}
                >
                  <option value="LFP6">LFP6</option>
                  <option value="LFP9">LFP9</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Batch (3 digits)</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-2"
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  maxLength={3}
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" onClick={saveConfig}>
                Save Config
              </Button>
              <Button variant="ghost" onClick={previewNext}>
                Preview Next
              </Button>
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Next pack serial: <b>{nextSerial}</b>
            </div>
          </div>

          <div className="border rounded p-3 bg-slate-50">
            <h3 className="font-semibold mb-2">Packs</h3>
            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {packs.map((p) => (
                <button
                  key={p.pack_serial}
                  className={`w-full text-left rounded px-3 py-2 border ${selected === p.pack_serial ? "bg-emerald-100 border-emerald-300" : "bg-white hover:bg-slate-50"}`}
                  onClick={() => setSelected(p.pack_serial)}
                >
                  <div className="font-medium">{p.pack_serial}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(p.created_at).toLocaleString()} ·{" "}
                    {p.created_by || "—"}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="md:col-span-8">
          {current ? (
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Edit {current.pack_serial}
                </h2>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={saveEdits}>
                    Save
                  </Button>
                  <Button variant="destructive" onClick={deletePack}>
                    Delete
                  </Button>
                </div>
              </div>
              {/* Codes preview */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <figure className="border rounded p-3 bg-white shadow-sm">
                  <img src={current.codes.module1} alt="module1" className="mx-auto h-auto max-w-full object-contain" />
                  <figcaption className="mt-2 text-center text-xs break-all">{current.codes.module1.split('/').pop()}</figcaption>
                  <div className="mt-2 flex justify-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => printImage(current.codes.module1)}>Print</Button>
                    <Button variant="outline" size="sm" onClick={() => downloadImage(current.codes.module1)}>Download</Button>
                  </div>
                </figure>
                <figure className="border rounded p-3 bg-white shadow-sm">
                  <img src={current.codes.module2} alt="module2" className="mx-auto h-auto max-w-full object-contain" />
                  <figcaption className="mt-2 text-center text-xs break-all">{current.codes.module2.split('/').pop()}</figcaption>
                  <div className="mt-2 flex justify-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => printImage(current.codes.module2)}>Print</Button>
                    <Button variant="outline" size="sm" onClick={() => downloadImage(current.codes.module2)}>Download</Button>
                  </div>
                </figure>
                <figure className="border rounded p-3 bg-white shadow-sm">
                  <img src={current.codes.master} alt="master" className="mx-auto h-auto max-w-full object-contain" />
                  <figcaption className="mt-2 text-center text-xs break-all">{current.codes.master.split('/').pop()}</figcaption>
                  <div className="mt-2 flex justify-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => printImage(current.codes.master)}>Print</Button>
                    <Button variant="outline" size="sm" onClick={() => downloadImage(current.codes.master)}>Download</Button>
                  </div>
                </figure>
              </div>

              {/* Module editors */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {Object.keys(current.modules).map((mid) => (
                  <div key={mid} className="border rounded p-3">
                    <h3 className="font-medium">{mid}</h3>
                    <Textarea
                      className="mt-2"
                      rows={10}
                      value={editing[mid] || ""}
                      onChange={(e) => setEditing((s) => ({ ...s, [mid]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-slate-500">Select a pack to edit</div>
          )}
        </section>
      </main>
    </div>
  );
}
