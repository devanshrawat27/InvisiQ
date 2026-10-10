<div align="center">

<br/>

```
██╗███╗   ██╗██╗   ██╗██╗███████╗██╗ ██████╗
██║████╗  ██║██║   ██║██║██╔════╝██║██╔═══██╗
██║██╔██╗ ██║██║   ██║██║███████╗██║██║   ██║
██║██║╚██╗██║╚██╗ ██╔╝██║╚════██║██║██║▄▄ ██║
██║██║ ╚████║ ╚████╔╝ ██║███████║██║╚██████╔╝
╚═╝╚═╝  ╚═══╝  ╚═══╝  ╚═╝╚══════╝╚═╝ ╚══▀▀═╝
```

**The Invisible Queue · No Lines. No Waiting. No Chaos.**

<br/>

[![Live](https://img.shields.io/badge/●_LIVE-00C853?style=flat-square&labelColor=0a0a0a)](https://invisi-q.vercel.app)
[![React](https://img.shields.io/badge/React_18-61DAFB?style=flat-square&logo=react&logoColor=black&labelColor=0a0a0a)](https://react.dev)
[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black&labelColor=0a0a0a)](https://firebase.google.com)
[![Gemini AI](https://img.shields.io/badge/Gemini_AI-4285F4?style=flat-square&logo=google&logoColor=white&labelColor=0a0a0a)](https://deepmind.google/technologies/gemini/)

<br/>

</div>

---

## What is InvisiQ?

InvisiQ is an AI-powered virtual queue system built for Indian college administration offices — Fee Cells, Admission Cells, and beyond. Students join a live digital queue by scanning a QR code. No app. No account. No standing in line.

Five specialized AI monitors run silently in the background, keeping the queue clean, fair, and real-time.

---

## Try It — Scan to Join

<div align="center">

| 🏛️ Admission Cell | 💸 Fee Cell |
|:---:|:---:|
| <img src="admission_cell_qr_code.png" width="160"/> | <img src="fee_cell_qr_code.png" width="160"/> |
| Scan to join the Admission queue | Scan to join the Fee queue |

*Or visit directly → [invisi-q.vercel.app](https://invisi-q.vercel.app)*

</div>

---

## AI Monitors

Five autonomous monitors run continuously on every queue:

| Monitor | Role |
|---|---|
| **Ghost Buster** | Removes users who silently abandoned the queue |
| **Congestion Oracle** | Predicts bottlenecks and auto-pauses before chaos |
| **Fraud Scanner** | Blocks spam entries and duplicate registrations |
| **Urgency Engine** | Dynamically recalculates wait times based on live throughput |
| **Counter Compass** | Routes students to the fastest available counter |

---

## Tech Stack

```
Frontend   →  React 18 · Vite · Tailwind CSS · Recharts
Backend    →  Node.js · Express · Socket.io
Database   →  Firebase Realtime Database
AI         →  Google Gemini API
Deploy     →  Vercel (frontend) · Render (backend)
```

---

## Admin Access

1. Go to **[invisi-q.vercel.app/admin](https://invisi-q.vercel.app/admin)**
2. Sign in with one of the seeded accounts below
3. Select your cell (Fee, Admission, Exam, Admin…)

| Role | Username | Password | Access |
|---|---|---|---|
| Super Admin | `superadmin` | `Super@123` | All cells + Setup & Admins |
| Fee Cell | `fee_admin` | `Fee@123` | Fee Cell only |
| Admission Cell | `admission_admin` | `Admission@123` | Admission Cell only |
| Exam Cell | `exam_admin` | `Exam@123` | Exam Cell only |
| Admin Cell | `admin_cell` | `Admin@123` | Admin Cell only |

---

## Local Setup

```bash
# Clone
git clone https://github.com/devanshrawat27/InvisiQ.git
cd InvisiQ

# Backend
cd backend && npm install
# Add .env with Firebase + Gemini keys
npm start

# Frontend (new terminal)
cd frontend && npm install
npm run dev
```

### Running without any cloud services
Set `MOCK_MODE=true` in `backend/.env` to run fully offline — queue state is kept in
memory and AI calls return mock responses.

---

## Production Deployment

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | **Required.** Long random string. The server refuses to start in production without it. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` | Firebase Admin service-account credentials |
| `GEMINI_API_KEY` | Google Gemini API key |
| `CORS_ORIGIN` | Comma-separated allowed frontend origins |
| `MOCK_MODE` | `false` |

**Security notes**
- Admin auth = username/password JWTs (bcrypt, 24h, login rate-limited). No bypass tokens.
- Google sign-in is accepted **only** for identities already linked to an admin.
- Admin routes enforce **per-cell authorization**; change the seeded default admin passwords before going live.

---

## Tests

```bash
cd backend
npm test          # end-to-end API tests (server must be running)
npm run test:audit # auth / validation / admin-ops / concurrency checks
npm run test:unit  # queue service + monitors, in-memory (no server)

cd ../frontend && npm run build   # verify the production bundle
```

---

## Architecture

- **Single source of truth** for queue state lives in `backend/services/queueService.js`
  (ordering, positions, waits, counter selection, and all state transitions), guarded by a
  per-queue lock so concurrent joins can’t corrupt state.
- **Monitors** (`backend/monitors/*`) are advisory by default — the queue only moves when an
  admin acts. Ghost detection uses live socket presence.
- **Real-time** via Socket.io with targeted per-user emits (`backend/socket/registry.js`).
