# SaveVid — Video Downloader

Free online video downloader supporting YouTube, TikTok, Facebook, Instagram, Twitter/X and 1000+ sites via yt-dlp.

## Structure
- `backend/` — Node.js + Express API (uses yt-dlp + ffmpeg)
  - `POST /api/info` — video metadata + quality list
  - `GET /api/download` — stream download
  - Serves `backend/public/` static frontend
- `public/` — frontend source (copied to backend/public on deploy)

## Run locally
```bash
cd backend && npm install && node server.js
# open http://localhost:3001
```
Requires: `yt-dlp` and `ffmpeg` on PATH.

## Deploy
Backend needs a VPS (yt-dlp doesn't run on serverless). Set `PORT` env as needed.
