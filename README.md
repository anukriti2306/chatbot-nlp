---
title: Document Translator
sdk: docker
app_port: 7860
---
# Document translation chatbot

FastAPI backend + React (Vite) frontend. Translates English text or `.txt/.pdf/.docx` files into Kannada, Hindi, Tamil, Telugu, Malayalam or Marathi with NLLB-200 (600M), and returns both the native-script translation and a romanized pronunciation guide. Uploaded files also get a downloadable bilingual PDF.

```
backend/
  main.py            FastAPI: GET /api/health, GET /api/languages, POST /api/translate, GET /api/download/{id}.pdf
  fonts/             Noto Sans fonts (bundled) used to render the PDF in each script
  generated/         translated PDFs land here at runtime
frontend/            React + Vite (src/App.jsx, src/api.js, src/App.css)
Dockerfile           builds the React app, then packages it with the backend (model baked in)
```

## Run locally (two terminals)
```
# 1. backend
pip install torch
pip install -r backend/requirements.txt
uvicorn backend.main:app --port 8000

# 2. frontend
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api to port 8000)
```
The first backend run downloads ~2.4 GB.

## Speed
Decoding uses greedy search (`num_beams=1`) instead of beam search — a large speedup on CPU with only a small quality trade-off. If you have a GPU available, install the matching CUDA build of torch instead of the CPU wheel and it will use it automatically.

## Deploy (easiest: Hugging Face Spaces, free CPU with 16 GB RAM)
1. Create a new Space, choose **Docker** as the SDK.
2. Upload this whole folder. It builds and gives you one public URL serving UI + API.

To host the frontend separately (Netlify, Vercel): deploy `frontend/` there with build command `npm run build`, output `dist`, and env var `VITE_API_URL` set to the backend URL. Set the backend env var `ALLOWED_ORIGINS` to the frontend URL.