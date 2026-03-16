# MathBuddy - AI Math Coaching Agent

> **GCP Project ID:** `math-coach-agent` &nbsp;|&nbsp; **Gemini Live Agent Challenge Entry**

Real-time voice coaching for math students, powered by Google's **Gemini Live API** and the **Agent Development Kit (ADK)**. Students photograph their work, receive instant AI grading, and get personalized Socratic voice coaching -- all through a mobile-friendly web app.

Built for the [Gemini Live Agent Challenge](https://ai.google.dev/competition/projects/live-agents).

## Architecture

```
┌───────────────────────────┐    WebSocket (PCM audio)    ┌─────────────────────────────┐
│                           │ ◄──────────────────────────► │                             │
│    Next.js Frontend       │                              │    FastAPI + Google ADK      │
│    (Mobile-first PWA)     │    REST API (JSON)           │    (Python Backend)          │
│                           │ ◄──────────────────────────► │                             │
│  ┌──────────┐ ┌────────┐ │                              │  ┌────────────────────────┐ │
│  │ Student  │ │ Admin  │ │                              │  │     root_agent (ADK)   │ │
│  │  Mode    │ │  Mode  │ │                              │  │  ├─ coaching_agent ─────┼─┼──► Gemini Live API
│  │ Solve    │ │ Scan   │ │                              │  │  │  (voice, real-time)  │ │    (native audio)
│  │ Coach    │ │ Wizard │ │                              │  │  ├─ grading_agent ──────┼─┼──► Gemini Vision
│  │ Review   │ │        │ │                              │  │  ├─ variant_agent       │ │
│  └──────────┘ └────────┘ │                              │  │  └─ scan_agent         │ │
└───────────────────────────┘                              │  └────────────────────────┘ │
                                                           │            │                │
                                                           │   ┌────────┴────────┐       │
                                                           │   │   Firestore     │       │
                                                           │   │   + GCS Bucket  │       │
                                                           │   └─────────────────┘       │
                                                           └─────────────────────────────┘
                                                                  Google Cloud Run
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS v4, Zustand, next-intl (i18n) |
| Backend | Python 3.12, FastAPI, Google ADK, firebase-admin |
| AI Models | Gemini 2.5 Flash (text/vision), Gemini Live 2.5 Flash (native audio) |
| Database | Cloud Firestore |
| File Storage | Google Cloud Storage (signed URLs) |
| Auth | Firebase Authentication (Google Sign-In) |
| Deploy | Google Cloud Run (Docker) |

## Features

### Real-time Voice Coaching (Gemini Live API)
Socratic-method tutoring via interruptible audio conversations. The AI never reveals answers -- it asks guiding questions, detects misconceptions, and encourages self-correction. Supports barge-in (students can interrupt the AI mid-sentence).

### Photo Grading (Gemini Vision)
Students photograph their handwritten work. The grading agent compares it against the answer database, identifies specific error types (sign errors, order-of-operations mistakes, etc.), and provides targeted feedback.

### Admin Scan Wizard
Teachers/parents photograph workbook pages (answer keys, questions, explanations). The scan agent uses parallel OCR to extract problems, answers, and solution steps into a structured Answer DB with LaTeX formatting.

### Spaced Repetition Review
Wrong answers become "mistake cards" scheduled via the SM-2 algorithm. During review, students solve AI-generated variant problems (same concept, different numbers) and get re-coached on persistent mistakes.

### Multi-language Support
Full i18n with 9 languages (Korean, English, Japanese, Chinese, French, Spanish, German, Italian, Hindi). LaTeX math expressions are converted to natural speech per locale for voice coaching.

### SVG Diagram Generation
When problems reference geometric figures or graphs, the AI generates inline SVG diagrams rendered directly in the browser.

## Quick Start

### Prerequisites

- **Node.js** 20+
- **Python** 3.12+
- **Google Cloud** account with billing enabled
- **gcloud CLI** installed and authenticated

### 1. GCP Setup

```bash
# Set your project ID
export PROJECT_ID=your-project-id
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com

# Create Firestore database (Native mode)
gcloud firestore databases create --location=us-central1

# Create GCS bucket for images
export BUCKET_NAME=${PROJECT_ID}-images
gsutil mb -l us-central1 gs://$BUCKET_NAME

# Set CORS on the bucket (needed for signed URL uploads)
cat > /tmp/cors.json << 'CORS'
[{"origin": ["http://localhost:3000"], "method": ["GET", "PUT"], "maxAgeSeconds": 3600}]
CORS
gsutil cors set /tmp/cors.json gs://$BUCKET_NAME
```

### 2. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/) and add your GCP project
2. Enable **Authentication** > **Sign-in method** > **Google**
3. Copy your Firebase config values (API key, auth domain, project ID)

### 3. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env — fill in your project ID and bucket name

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

### 4. Frontend Setup

```bash
cd frontend
cp .env.local.example .env.local
# Edit .env.local — fill in your Firebase config

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser (works best on mobile or Chrome DevTools mobile view).

## Deploy to Cloud Run

### Backend

```bash
cd backend
gcloud run deploy mathbuddy-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GCS_BUCKET_NAME=$BUCKET_NAME,CORS_ORIGINS=https://your-frontend-url"
```

### Frontend

```bash
cd frontend
# Build with Docker (pass your config as build args)
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://mathbuddy-backend-xxxxx.run.app \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=your-key \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id \
  -t mathbuddy-frontend .

# Deploy to Cloud Run
gcloud run deploy mathbuddy-frontend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

> **Note**: Next.js embeds `NEXT_PUBLIC_*` variables at build time. When deploying to Cloud Run with `--source .`, set them as substitution variables in Cloud Build or use the Docker build-arg approach above.

## Project Structure

```
MathBuddy/
├── backend/                    # Python FastAPI server
│   ├── math_coach_agent/       # Google ADK agent package
│   │   ├── agent.py            # Root agent definition
│   │   └── sub_agents/         # Specialized agents
│   │       ├── coaching_agent.py   # Voice coaching (Gemini Live)
│   │       ├── grading_agent.py    # Photo grading (Gemini Vision)
│   │       ├── variant_agent.py    # Problem variant generation
│   │       └── scan_agent.py       # Workbook OCR/scanning
│   ├── routers/                # API route handlers
│   │   ├── ws_audio.py         # WebSocket for live audio
│   │   ├── study.py            # Solve/verify/coach flow
│   │   ├── scan.py             # Scan wizard endpoints
│   │   ├── review.py           # Spaced repetition review
│   │   └── workbooks.py        # Workbook CRUD
│   ├── services/               # Business logic
│   │   ├── grading_service.py  # AI grading pipeline
│   │   ├── scan_service.py     # Parallel OCR extraction
│   │   ├── scheduler_service.py # SM-2 scheduling
│   │   └── variant_service.py  # Variant problem generation
│   ├── config.py               # Central constants (no hardcoding)
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/                   # Next.js 16 web app
│   └── src/
│       ├── app/
│       │   ├── student/        # Student mode pages
│       │   │   ├── solve/      # Photo submission + grading
│       │   │   ├── teacher/    # Voice coaching session
│       │   │   └── ...
│       │   └── parent/         # Admin mode pages
│       │       ├── scan/       # Workbook scan wizard
│       │       └── workbook/   # Answer key management
│       ├── components/         # Shared React components
│       ├── lib/                # Utilities, store, constants
│       └── messages/           # i18n translations (9 languages)
├── firebase.json               # Firebase Hosting config
└── README.md
```

## How It Works

### Study Flow

1. **Scan** (Admin): Photograph workbook pages to build the Answer DB
2. **Solve** (Student): Select a problem, photograph handwritten work, get instant grading
3. **Coach** (Student): If wrong, enter a voice coaching session with the AI tutor
4. **Verify** (Student): After coaching, re-attempt the problem for final grading
5. **Review** (Student): Periodically review mistake cards with variant problems (SM-2 scheduling)

### Voice Coaching Architecture

The coaching agent uses **Gemini Live API** with native audio I/O:

- Audio streams bidirectionally over WebSocket (16kHz PCM in, 24kHz PCM out)
- The agent receives problem context (question, student answer, correct answer, error type)
- Socratic prompting: asks guiding questions instead of revealing answers
- Supports barge-in (interrupt detection) for natural conversation flow
- Per-session agent instances with dynamic instruction injection

## Screenshots

*Coming soon*

## Category

**Live Agents** -- Real-time voice coaching with barge-in support via Gemini Live API

## License

MIT

---

Built with Google Gemini Live API & ADK for the #GeminiLiveAgentChallenge
