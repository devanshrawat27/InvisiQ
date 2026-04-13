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
2. Sign in with your admin credentials
3. Select your cell — Fee or Admission

**Controls available:** Call next · Mark attended · Pause queue · AI Nightly Briefing

> Admin credentials are distributed separately. Contact the project maintainer.

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

---

<div align="center">

*Built for hackathons. Designed for the real world.*

**InvisiQ** · No more standing in line.

</div>
