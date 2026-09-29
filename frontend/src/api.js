export const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") + "/api";
export const ORIGIN = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export const getLanguages = () => fetch(`${BASE}/languages`).then((r) => r.json());
export const getHealth = () => fetch(`${BASE}/health`).then((r) => r.json());

/**
 * Starts a translation job, then polls its status until done, calling
 * onProgress({ done, total }) after each poll. Resolves with the final
 * result: { translation, pronunciation, lang, sentence_count, char_count, download_url? }.
 */
export async function translate({ lang, text, file }, onProgress) {
  const fd = new FormData();
  fd.append("lang", lang);
  fd.append("text", text);
  if (file) fd.append("file", file);

  const startRes = await fetch(`${BASE}/translate/start`, { method: "POST", body: fd });
  const start = await startRes.json().catch(() => ({}));
  if (!startRes.ok) throw new Error(start.detail || "Something went wrong.");

  const jobId = start.job_id;
  while (true) {
    await new Promise((r) => setTimeout(r, 700));
    const res = await fetch(`${BASE}/translate/status/${jobId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Something went wrong.");
    if (data.status === "done") return data;
    onProgress?.({ done: data.done, total: data.total });
  }
}