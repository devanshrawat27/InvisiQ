<div align="center">
  
# 🔮 InvisiQ (Invisible Queue System)
**AI-First Virtual Queue Engine for Indian College Offices**

![Project Status](https://img.shields.io/badge/Status-Live-success?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/React-18-blue?style=for-the-badge&logo=react)
![Tech Stack](https://img.shields.io/badge/Node.js-Express-green?style=for-the-badge&logo=nodedotjs)
![Tech Stack](https://img.shields.io/badge/AI-Google_Gemini-orange?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/Database-Firebase-yellow?style=for-the-badge&logo=firebase)

</div>

## 📌 Overview
InvisiQ is an advanced, AI-powered waitlist and virtual queue platform designed to eliminate physical standing queues outside busy college administration offices (like Fee Cells, Admission Cells, etc.). 

It digitizes the queuing process while deploying intelligent AI monitors that actively observe the queue's state and automatically handle stale, fraudulent, or overly congested lines.

## ✨ Key Features
- **🌐 Seamless "Join Queue" Flow:** Students join by scanning a QR code or visiting a link — no app downloads required.
- **🛡️ Multi-Cell Architecture:** Completely isolated states for different college offices (e.g., Admission Cell, Fee Cell).
- **⚡ Real-time Updates:** Powered by Socket.io, providing live feedback to students regarding their position and estimated wait times.
- **🤖 5 Specialized AI Monitors (Powered by Google Gemini):**
  - `Ghost Buster AI`: Detects and removes "ghost" users who abandoned the queue.
  - `Congestion Oracle AI`: Predicts severe bottlenecks and pauses queues automatically.
  - `Fraud Scanner AI`: Prevents span and duplicate entries.
  - `Urgency Engine AI`: Adjusts wait-time calculations dynamically based on throughput.
  - `Counter Compass AI`: Smartly routes students to the most optimal counter.

---

## 🛠️ Technology Stack
- **Frontend**: React 18, Vite, Tailwind CSS, Recharts
- **Backend**: Node.js, Express, Socket.io
- **Database & Auth**: Firebase Realtime Database, Firebase Admin SDK
- **AI Integration**: Google Gemini API

---

## 🚀 Live Links
- **Student Portal (Frontend)**: [https://invisi-q.vercel.app](https://invisi-q.vercel.app)
- **Backend API**: [https://invisiq.onrender.com](https://invisiq.onrender.com)

---

## 🔐 Admin Dashboard Access

As an administrator, you have full control over the queues, counters, and AI monitors.

**How to log in:**
1. Go to the live admin URL: 👉 **[https://invisi-q.vercel.app/admin](https://invisi-q.vercel.app/admin)**
2. You will be prompted to log in using the Admin's configured Email and Password.
3. Once logged in, you can select the specific Queue Cell (e.g., Fee Cell) to manage.

**What you can do as an Admin:**
- **Call Next User**: Ping the next student in line to approach the counter.
- **Mark Attended/Removed/Done**: Update the live status of the current user.
- **Pause/Resume Queue**: Temporarily halt new entries if the office gets too crowded.
- **View AI Briefings**: Get an AI-generated summary of queue performance and recommendations using the Nightly Briefing tool.

---

## 💻 Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/devanshrawat27/InvisiQ.git
   cd InvisiQ
   ```

2. **Setup the Backend:**
   ```bash
   cd backend
   npm install
   cp .env.example .env   # then fill in the values
   npm start
   ```

3. **Setup the Frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

### Tests
```bash
cd backend
npm test          # end-to-end API tests (needs the server running)
npm run test:unit # queue service + monitors, in-memory (no server)
```
`cd frontend && npm run build` to verify the production bundle.

### Running without any cloud services
Set `MOCK_MODE=true` in `backend/.env` to run fully offline: queue state is stored
in memory and AI calls return mock responses. Handy for local development.

---

## 🏭 Production Deployment

Set the following environment variables on the backend host:

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | **Required.** A long random string. The server refuses to start in production without it. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` | Firebase Admin service-account credentials |
| `GEMINI_API_KEY` | Google Gemini API key |
| `CORS_ORIGIN` | Comma-separated list of allowed frontend origins (no `*` with credentials) |
| `MOCK_MODE` | `false` |
| `PORT` | Server port |

Frontend (`frontend/.env`): `VITE_BACKEND_URL`, `VITE_SOCKET_URL`, and the
`VITE_FIREBASE_*` client config.

**Security notes**
- Admin auth uses username/password JWTs (bcrypt-hashed, 24h expiry, login rate-limited).
- Google sign-in is accepted **only** for Firebase identities already linked to an admin
  account (matching `firebase_uid` or username); unlinked identities are rejected.
- There are no demo/bypass tokens. Seed/simulate demo endpoints were removed.
- Public endpoints are rate-limited; admin endpoints enforce per-cell authorization.

> ⚠️ Never commit `.env` files. Rotate any credentials that were ever shared.

## 📄 License
This project is proprietary and intended for hackathons / educational purposes.

<div align="center">
  <i>Powered by AI · No more standing in line.</i>
</div>