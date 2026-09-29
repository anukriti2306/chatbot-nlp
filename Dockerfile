# Stage 1: build the React frontend
FROM node:20-slim AS ui
WORKDIR /ui
COPY frontend/package.json ./
RUN npm install
COPY frontend .
RUN npm run build

# Stage 2: FastAPI backend that also serves the built frontend
FROM python:3.11-slim
RUN useradd -m -u 1000 app
WORKDIR /home/app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r backend/requirements.txt
# Bake the model into the image so start-up doesn't re-download it
ENV HF_HOME=/home/app/.cache/huggingface
RUN python -c "from transformers import AutoTokenizer, AutoModelForSeq2SeqLM as M; m='facebook/nllb-200-distilled-600M'; AutoTokenizer.from_pretrained(m); M.from_pretrained(m)"
COPY backend backend
COPY --from=ui /ui/dist frontend/dist
RUN chown -R app /home/app
USER app
EXPOSE 7860
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
