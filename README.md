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
   # Create a .env file based on the config.js requirements!
   npm start
   ```

3. **Setup the Frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## 📄 License
This project is proprietary and intended for hackathons / educational purposes.

<div align="center">
  <i>Powered by AI · No more standing in line.</i>
</div>