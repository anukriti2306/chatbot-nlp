"""Document translation chatbot API.

English -> Indian languages, using Meta's NLLB-200. Translation runs as a
background job so the frontend can poll for live progress on longer documents.
Each result includes the translated text and a romanized pronunciation guide;
uploaded files also get back a translated PDF (with a pronunciation line under
each paragraph), not just a raw text blob.
"""
import io
import os
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from indic_transliteration import sanscript
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

MODEL_ID = "facebook/nllb-200-distilled-600M"

LANGS = {
    "Kannada":    {"nllb": "kan_Knda", "script": sanscript.KANNADA,    "font": "NotoSansKannada-Regular.ttf"},
    "Hindi":      {"nllb": "hin_Deva", "script": sanscript.DEVANAGARI, "font": "NotoSansDevanagari-Regular.ttf"},
    "Tamil":      {"nllb": "tam_Taml", "script": sanscript.TAMIL,      "font": "NotoSansTamil-Regular.ttf"},
    "Telugu":     {"nllb": "tel_Telu", "script": sanscript.TELUGU,     "font": "NotoSansTelugu-Regular.ttf"},
    "Malayalam":  {"nllb": "mal_Mlym", "script": sanscript.MALAYALAM,  "font": "NotoSansMalayalam-Regular.ttf"},
    "Marathi":    {"nllb": "mar_Deva", "script": sanscript.DEVANAGARI, "font": "NotoSansDevanagari-Regular.ttf"},
}

MAX_FILE_MB, MAX_CHARS, BATCH = 20, 200_000, 16
JOB_TTL_SECONDS = 30 * 60  # forget finished jobs after this long

FONT_DIR = Path(__file__).resolve().parent / "fonts"
OUT_DIR = Path(__file__).resolve().parent / "generated"
OUT_DIR.mkdir(exist_ok=True)

state = {}
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    state["tok"] = AutoTokenizer.from_pretrained(MODEL_ID, src_lang="eng_Latn")
    state["model"] = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID, torch_dtype=torch.float32).eval()
    for name, cfg in LANGS.items():
        pdfmetrics.registerFont(TTFont(name, FONT_DIR / cfg["font"]))
    pdfmetrics.registerFont(TTFont("Latin", FONT_DIR / "NotoSans-Regular.ttf"))
    yield


app = FastAPI(title="Translator API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- text extraction ----------

def extract_text(name: str, data: bytes) -> str:
    name = name.lower()
    try:
        if name.endswith(".pdf"):
            from pypdf import PdfReader
            return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
        if name.endswith(".docx"):
            from docx import Document
            return "\n".join(p.text for p in Document(io.BytesIO(data)).paragraphs)
        if name.endswith(".txt"):
            return data.decode("utf-8", errors="ignore")
    except Exception:
        raise HTTPException(422, "Could not read that file. Try a different one.")
    raise HTTPException(415, "Unsupported file type. Use .txt, .pdf or .docx.")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?।])\s+", text) if s.strip()]


def split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n+", text) if p.strip()]


# ---------- translation + pronunciation ----------

def translate_batch(sents: list[str], lang: str) -> list[str]:
    """Greedy decoding (num_beams=1) - much faster on CPU than beam search,
    with only a small quality trade-off for short/medium sentences."""
    tok, model = state["tok"], state["model"]
    target = LANGS[lang]["nllb"]
    enc = tok(sents, return_tensors="pt", padding=True, truncation=True, max_length=256)
    with torch.no_grad():
        gen = model.generate(
            **enc,
            forced_bos_token_id=tok.convert_tokens_to_ids(target),
            max_new_tokens=300,
            num_beams=1,
            do_sample=False,
        )
    return tok.batch_decode(gen, skip_special_tokens=True)


def romanize(text: str, lang: str) -> str:
    """Best-effort pronunciation guide: transliterates the target script to
    readable Latin letters (ITRANS scheme) so the sound can be read aloud."""
    try:
        return sanscript.transliterate(text, LANGS[lang]["script"], sanscript.ITRANS)
    except Exception:
        return ""


def escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_pdf(path: Path, lang: str, paragraphs: list[tuple[str, str]]):
    """paragraphs: list of (translated_paragraph, pronunciation_paragraph).
    Reads like an actual translated document, with a compact pronunciation
    line under each paragraph rather than a sentence-by-sentence table."""
    doc = SimpleDocTemplate(str(path), pagesize=A4,
                            topMargin=22 * mm, bottomMargin=22 * mm,
                            leftMargin=20 * mm, rightMargin=20 * mm)
    title = ParagraphStyle("title", fontName="Latin", fontSize=17, leading=22, spaceAfter=16)
    tgt = ParagraphStyle("tgt", fontName=lang, fontSize=13, leading=20, spaceAfter=3)
    rom = ParagraphStyle("rom", fontName="Latin", fontSize=9.5, leading=13, textColor="#7a7a7a", spaceAfter=14)

    story = [Paragraph(f"English &rarr; {lang}", title)]
    for translated, pron in paragraphs:
        story.append(Paragraph(escape(translated), tgt))
        if pron:
            story.append(Paragraph(escape(pron), rom))
        story.append(Spacer(1, 2))
    doc.build(story)


# ---------- background job ----------

def _prune_jobs():
    cutoff = time.time() - JOB_TTL_SECONDS
    for jid in [j for j, v in jobs.items() if v.get("finished_at", time.time()) < cutoff]:
        jobs.pop(jid, None)


def run_job(job_id: str, text: str, lang: str, is_file: bool):
    job = jobs[job_id]
    try:
        paragraphs = split_paragraphs(text) or [text]
        # flatten to sentences, remembering which paragraph each belongs to
        flat, owner = [], []
        for i, p in enumerate(paragraphs):
            for s in (split_sentences(p) or [p]):
                flat.append(s)
                owner.append(i)

        job["total"] = len(flat)
        translated_flat = [None] * len(flat)

        for start in range(0, len(flat), BATCH):
            chunk = flat[start:start + BATCH]
            out = translate_batch(chunk, lang)
            for k, t in enumerate(out):
                translated_flat[start + k] = t
            with jobs_lock:
                job["done"] = min(start + BATCH, len(flat))

        pron_flat = [romanize(t, lang) for t in translated_flat]

        # regroup sentence-level output back into paragraphs
        para_translated = ["" for _ in paragraphs]
        para_pron = ["" for _ in paragraphs]
        for i in range(len(flat)):
            p = owner[i]
            para_translated[p] = (para_translated[p] + " " + translated_flat[i]).strip()
            para_pron[p] = (para_pron[p] + " " + pron_flat[i]).strip()

        translation = "\n\n".join(para_translated)
        pronunciation = "\n\n".join(para_pron)

        result = {
            "lang": lang,
            "translation": translation,
            "pronunciation": pronunciation,
            "sentence_count": len(flat),
            "char_count": len(text),
        }

        if is_file:
            file_id = uuid.uuid4().hex
            pdf_path = OUT_DIR / f"{file_id}.pdf"
            build_pdf(pdf_path, lang, list(zip(para_translated, para_pron)))
            result["download_url"] = f"/api/download/{file_id}.pdf"

        with jobs_lock:
            job["status"] = "done"
            job["result"] = result
            job["finished_at"] = time.time()
    except HTTPException as e:
        with jobs_lock:
            job["status"] = "error"
            job["error"] = e.detail
            job["finished_at"] = time.time()
    except Exception as e:
        with jobs_lock:
            job["status"] = "error"
            job["error"] = f"Translation failed: {e}"
            job["finished_at"] = time.time()


# ---------- routes ----------

@app.get("/api/health")
def health():
    return {"ready": "model" in state}


@app.get("/api/languages")
def languages():
    return list(LANGS)


@app.post("/api/translate/start")
def start_translate(lang: str = Form("Kannada"), text: str = Form(""), file: UploadFile | None = File(None)):
    if "model" not in state:
        raise HTTPException(503, "The model is still loading. Try again in a moment.")
    if lang not in LANGS:
        raise HTTPException(400, "Unsupported language.")

    is_file = bool(file and file.filename)
    if is_file:
        data = file.file.read(MAX_FILE_MB * 1024 * 1024 + 1)
        if len(data) > MAX_FILE_MB * 1024 * 1024:
            raise HTTPException(413, f"File is too large. The limit is {MAX_FILE_MB} MB.")
        text = (extract_text(file.filename, data) + "\n" + text).strip()
    else:
        text = text.strip()

    if not text:
        raise HTTPException(400, "Nothing to translate. Type text or attach a .txt, .pdf or .docx file.")
    if len(text) > MAX_CHARS:
        raise HTTPException(413, f"Text is too long. The limit is {MAX_CHARS:,} characters.")

    with jobs_lock:
        _prune_jobs()
        job_id = uuid.uuid4().hex
        jobs[job_id] = {"status": "processing", "done": 0, "total": 1, "result": None, "error": None}

    threading.Thread(target=run_job, args=(job_id, text, lang, is_file), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/translate/status/{job_id}")
def translate_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown or expired job.")
    if job["status"] == "error":
        raise HTTPException(500, job["error"])
    payload = {"status": job["status"], "done": job["done"], "total": job["total"]}
    if job["status"] == "done":
        payload.update(job["result"])
    return payload


@app.get("/api/download/{file_id}.pdf")
def download(file_id: str):
    path = OUT_DIR / f"{file_id}.pdf"
    if not re.fullmatch(r"[0-9a-f]{32}", file_id) or not path.exists():
        raise HTTPException(404, "That file is no longer available.")
    return FileResponse(path, media_type="application/pdf", filename="translation.pdf")


# Serve the built frontend from the same container (single-deploy mode)
FRONTEND = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")