**INVISIBLE QUEUE SYSTEM**

**FRONTEND REQUIREMENTS DOCUMENT**

*Complete Specification for LLM-Assisted Frontend Build*

  ------------------------------- ---------------------------------------
  **Document Type**               Frontend Requirements + Component Spec

  **Backend Status**              COMPLETE --- Do not modify backend

  **Frontend Stack**              React 18 + Vite · TailwindCSS ·
                                  Socket.io · shadcn/ui

  **Target Users**                Students (mobile-first) + Admins
                                  (desktop)

  **AI Engine**                   claude-sonnet-4-20250514 (backend-only)

  **Version**                     v1.0 --- Final Handoff
  ------------------------------- ---------------------------------------

  -----------------------------------------------------------------------
  ⛔ READ BEFORE BUILDING: The backend is fully complete. Your ONLY job
  is to build the frontend exactly as described in this document. Never
  put the ANTHROPIC_API_KEY in frontend code. Never build a chat widget
  --- it was removed. All AI responses arrive via Socket.io events or
  REST API responses.

  -----------------------------------------------------------------------

**0. Architecture Overview**

Before writing a single line of code, understand how data flows through
this system. The frontend is a consumer of backend events and REST
responses --- it never calls Claude directly.

  ---------------- --- ----------------- --- ----------------- ---- ------------
  **Student        →   **Backend         →   **Claude AI       \+   **Firebase
  Browser (React       (Node/Express +       (Server-side)**        RT DB**
  PWA)**               Socket.io)**                                 

  ---------------- --- ----------------- --- ----------------- ---- ------------

**The frontend has two distinct surfaces:**

-   StudentApp --- Mobile-first PWA. Students scan QR, join queue, watch
    position, receive flash alerts.

-   AdminDashboard --- Desktop-optimised dashboard. Admin monitors
    queue, marks Attended / Removed, views AI briefing.

  -----------------------------------------------------------------------
  ⚠ KEY RULE: Admin does NOT have a \"Call Next\" button. The AI
  auto-advances the queue. Admin only clicks ATTENDED or REMOVED when a
  user physically arrives at the counter.

  -----------------------------------------------------------------------

**1. Pages & Routing**

Use React Router v6. The app has 4 routes total.

  ------------------ --------------------- -------------------------------
  **Route**          **Component**         **Purpose**

  /                  LandingPage           QR scan landing --- shows queue
                                           info + Join button

  /queue/:id/join    JoinPage              Student fills join form and
                                           submits

  /queue/:id/wait    WaitingRoom           Live position counter + flash
                                           alerts (main student screen)

  /admin             AdminDashboard        Full admin view --- queue list,
                                           AI briefing, controls
  ------------------ --------------------- -------------------------------

  -----------------------------------------------------------------------
  ℹ The URL /queue/:id/join and /queue/:id/wait must preserve the
  queue_id. Pass it as a URL param, not localStorage. The QR code printed
  on paper encodes the URL /queue/fee_cell/join --- so :id =
  \"fee_cell\".

  -----------------------------------------------------------------------

**2. Global State & Custom Hooks**

**2.1 useSocket.js**

Manages the Socket.io connection lifecycle. Connect once when
WaitingRoom mounts, disconnect on unmount.

+-----------------------------------------------------------------------+
| // hooks/useSocket.js                                                 |
|                                                                       |
| import { useEffect, useRef } from \'react\';                          |
|                                                                       |
| import io from \'socket.io-client\';                                  |
|                                                                       |
| export function useSocket(queueId, handlers) {                        |
|                                                                       |
| const socketRef = useRef(null);                                       |
|                                                                       |
| useEffect(() =\> {                                                    |
|                                                                       |
| const socket = io(import.meta.env.VITE_BACKEND_URL);                  |
|                                                                       |
| socketRef.current = socket;                                           |
|                                                                       |
| socket.emit(\'join_room\', { queue_id: queueId });                    |
|                                                                       |
| // Bind all handlers                                                  |
|                                                                       |
| Object.entries(handlers).forEach((\[event, fn\]) =\> socket.on(event, |
| fn));                                                                 |
|                                                                       |
| return () =\> { socket.disconnect(); };                               |
|                                                                       |
| }, \[queueId\]);                                                      |
|                                                                       |
| return socketRef;                                                     |
|                                                                       |
| }                                                                     |
+-----------------------------------------------------------------------+

**Events the frontend must listen for:**

  ------------------- ---------------------------------------------------
  **Socket Event**    **Frontend Action**

  queue_update        Refresh position number, avg wait, user list on
                      admin dashboard

  flash_message       Display FlashAlert banner on student screen with
                      message from payload.message

  turn_called         Trigger full-screen \"YOUR TURN\" banner with
                      token + counter number

  surge_alert         Show orange SurgeAlert banner on both student +
                      admin screens

  ghost_flag          Admin: show ghost icon badge on that user row

  fraud_alert         Admin: red fraud badge in notification tray

  turn_approaching    Student: show \"You are 3 spots away\" flash +
                      trigger Web Push
  ------------------- ---------------------------------------------------

**2.2 useQueue.js**

Fetches and caches queue status. Re-fetches every 30 seconds as a safety
net alongside Socket.io.

+-----------------------------------------------------------------------+
| // hooks/useQueue.js                                                  |
|                                                                       |
| export function useQueue(queueId) {                                   |
|                                                                       |
| const \[queue, setQueue\] = useState(null);                           |
|                                                                       |
| const \[loading, setLoading\] = useState(true);                       |
|                                                                       |
| const fetchStatus = async () =\> {                                    |
|                                                                       |
| const res = await                                                     |
| fetch(\`\${BACKEND}/api/v1/queue/\${queueId}/status\`);               |
|                                                                       |
| setQueue(await res.json());                                           |
|                                                                       |
| setLoading(false);                                                    |
|                                                                       |
| };                                                                    |
|                                                                       |
| useEffect(() =\> {                                                    |
|                                                                       |
| fetchStatus();                                                        |
|                                                                       |
| const interval = setInterval(fetchStatus, 30000);                     |
|                                                                       |
| return () =\> clearInterval(interval);                                |
|                                                                       |
| }, \[queueId\]);                                                      |
|                                                                       |
| return { queue, loading, refetch: fetchStatus };                      |
|                                                                       |
| }                                                                     |
+-----------------------------------------------------------------------+

**2.3 Local State Shape (WaitingRoom)**

Store this in a single useState object inside WaitingRoom. Do not use a
global store --- it is unnecessary.

+-----------------------------------------------------------------------+
| const \[myData, setMyData\] = useState({                              |
|                                                                       |
| name: \'\', // student name from join form                            |
|                                                                       |
| token: \'\', // e.g. \'Q-FEE-0042\'                                   |
|                                                                       |
| position: null, // 1-indexed, null = not yet                          |
|                                                                       |
| wait_minutes: null,                                                   |
|                                                                       |
| lower_bound: null,                                                    |
|                                                                       |
| upper_bound: null,                                                    |
|                                                                       |
| confidence: null,                                                     |
|                                                                       |
| intent_category: \'\',                                                |
|                                                                       |
| counter_id: \'\',                                                     |
|                                                                       |
| status: \'waiting\', // waiting \| called \| in_service \| served \|  |
| removed                                                               |
|                                                                       |
| });                                                                   |
|                                                                       |
| const \[flashAlert, setFlashAlert\] = useState(null); // { message,   |
| type }                                                                |
|                                                                       |
| const \[surgeActive, setSurgeActive\] = useState(false);              |
|                                                                       |
| const \[isTurn, setIsTurn\] = useState(false);                        |
+-----------------------------------------------------------------------+

**3. Page: LandingPage (/)**

The first screen a student sees when they scan the QR code. Must feel
instant and trustworthy on mobile.

**3.1 Layout**

Full-height centered card. No nav bar. Mobile-first (375px+).

  ---------- -------------------------------------------------------------
  **Zone**   **Content & Behaviour**

  Top        Queue name (large, bold). Queue type badge (e.g. \"Fee Cell\"
             \| \"Admission\"). Status pill: green=\"Open\",
             yellow=\"Paused\", red=\"Closed\".

  Middle     Live stats row: people in queue (count), avg wait (minutes),
             counters open (number). Each stat as a card with label +
             large number. Animated counter for \"people in queue\".

  Bottom     Big primary CTA button: \"Join Queue →\". If queue status ===
             \"closed\" or \"paused\", disable button and show reason
             message below.
  ---------- -------------------------------------------------------------

**3.2 Data Source**

-   On mount: fetch GET /api/v1/queue/:id/status

-   Show skeleton loaders while fetching (Tailwind animate-pulse on
    placeholder divs)

-   If status === \"closed\": show \"Queue is closed. Please come back
    later.\" and grey-out button.

**3.3 Micro-interactions**

-   The \"people in queue\" count should animate from 0 to actual value
    using a counter animation (simple requestAnimationFrame loop,
    \~600ms duration).

-   Join button: scale-up on hover (scale-105), purple-to-indigo
    gradient, rounded-xl, text-lg font-semibold.

-   Status pill uses a pulsing green dot for \"Open\" (CSS animation:
    ping from Tailwind).

**4. Page: JoinPage (/queue/:id/join)**

The student fills this form to enter the queue. Keep it minimal and
fast. Students are standing in a hallway.

**4.1 Form Fields**

  ---------------- ------------- ---------------- -------------------------
  **Field**        **Type**      **Validation**   **Notes**

  Full Name        text input    Required, 2--60  Placeholder: \"Rahul
                                 chars            Sharma\"

  Phone Number     tel input     Required,        Validate:
                                 10-digit Indian  /\^\[6-9\]\\d{9}\$/. Show
                                                  red border + message on
                                                  invalid.

  Visit Reason     textarea      Required, 5--200 Placeholder: \"Fee
                                 chars            payment --- deadline
                                                  today\". AI will classify
                                                  this.

  Priority         radio buttons Default: normal  3 options: Normal \|
                                                  Elderly /
                                                  Differently-abled \|
                                                  Emergency. Show icons
                                                  next to labels.
  ---------------- ------------- ---------------- -------------------------

**4.2 Submission Flow**

-   Client-side validation fires on blur (not on submit) for each field.

-   On \"Join Queue\" click: disable button, show loading spinner inside
    button, POST to /api/v1/queue/:id/join.

-   Request body: { name, phone, visit_reason, priority }.

-   On 200 response: store full response in sessionStorage as
    \"myQueueData\". Navigate to /queue/:id/wait.

-   On 409 (phone already in queue): show inline error \"You are already
    in this queue.\"

-   On 429 (rate limited): show \"Too many joins. Please wait a
    moment.\"

-   On any other error: show \"Something went wrong. Please try again.\"
    with retry button.

  -----------------------------------------------------------------------
  ℹ Store join response in sessionStorage\[\"myQueueData\"\]. The
  WaitingRoom reads this on mount. If sessionStorage is empty on
  WaitingRoom load, redirect back to LandingPage.

  -----------------------------------------------------------------------

**4.3 UX Notes**

-   Auto-focus the Name field on page load.

-   Priority radio: render as large tappable cards, not standard radio
    buttons. Each card 80px tall, full width, with icon + label.

-   Submit button text changes to \"Joining\...\" during loading state.

-   The phone field should show a +91 prefix label (non-editable)
    visually, but submit only the 10-digit number.

**5. Page: WaitingRoom (/queue/:id/wait)**

This is the most important page. Students may sit on this screen for 20+
minutes. Every state change must feel real-time and trustworthy.

  -----------------------------------------------------------------------
  ⚠ This page is the heart of the product. FlashAlert, SurgeAlert, and
  the \"YOUR TURN\" takeover all render here. Get this page perfect
  before moving to AdminDashboard.

  -----------------------------------------------------------------------

**5.1 On Mount**

-   Read myQueueData from sessionStorage. If missing, redirect to
    LandingPage.

-   Initialise myData state from sessionStorage data.

-   Connect Socket.io and join room: socket.emit(\"join_room\", {
    queue_id }).

-   Request browser notification permission (Web Push) immediately after
    join --- show a polite prompt.

**5.2 Layout Zones**

  ------------ ------------------------ ----------------------------------
  **Zone**     **Component**            **Content**

  Top Banner   SurgeAlert (conditional) Orange flashing banner: \"High
                                        traffic --- wait may be slightly
                                        longer.\" Hidden when surgeActive
                                        === false.

  Hero         PositionCard             Giant position number (e.g.
                                        \"#3\"). Animated decrement when
                                        queue_update fires. Sub-text: \"in
                                        queue\".

  Wait Info    WaitEstimate             \"11--16 min (87% confidence)\".
                                        Range uses
                                        lower_bound--upper_bound.
                                        Confidence as a small badge.

  Intent       IntentBadge              Colour-coded pill: \"Fee
                                        Payment\", \"Bonafide Cert\" etc.
                                        based on intent_category. Admin
                                        pre-classified this.

  Counter      CounterInfo              \"Head to Counter 1 when called.\"
                                        Only show if counter_id is
                                        assigned.

  Token        TokenDisplay             Display token prominently: \"Your
                                        Token: Q-FEE-0042\". Monospaced
                                        font, large.

  Flash Zone   FlashAlert               Non-dismissible banner. Appears
                                        when flash_message socket event
                                        fires. Auto-clears after 8
                                        seconds.

  Takeover     YourTurnOverlay          Full-screen modal when turn_called
                                        fires. See Section 5.5.
  ------------ ------------------------ ----------------------------------

**5.3 FlashAlert Component**

This is the primary communication channel between the system and the
student. No chatbot. No chat UI.

-   Triggered by: socket event flash_message arriving with payload {
    message: string, type: \"info\" \| \"warning\" \| \"urgent\" }.

-   Renders as a full-width banner ABOVE the PositionCard, below any
    SurgeAlert.

-   Not dismissible by user (no X button). Auto-disappears after 8
    seconds.

-   Type-based styling: info = violet bg, warning = amber bg, urgent =
    red bg with pulse animation.

-   If a new flash_message arrives before 8s, replace current one
    immediately (reset timer).

-   Do NOT render a chat input field anywhere. Ever.

+-----------------------------------------------------------------------+
| // FlashAlert.jsx                                                     |
|                                                                       |
| export function FlashAlert({ message, type = \'info\' }) {            |
|                                                                       |
| const bgMap = { info: \'bg-violet-100 border-violet-400\', warning:   |
| \'bg-amber-100 border-amber-400\', urgent: \'bg-red-100               |
| border-red-500 animate-pulse\' };                                     |
|                                                                       |
| return (                                                              |
|                                                                       |
| \<div className={\`w-full border-l-4 p-4 rounded-r-xl text-sm         |
| font-medium \${bgMap\[type\]}\`}\>                                    |
|                                                                       |
| {message}                                                             |
|                                                                       |
| \</div\>                                                              |
|                                                                       |
| );                                                                    |
|                                                                       |
| }                                                                     |
+-----------------------------------------------------------------------+

**5.4 Position Animation**

-   When position changes from N to N-1, animate the number: slide old
    number up and out, slide new number in from below.

-   Use CSS transition with transform: translateY. Duration: 400ms
    ease-out.

-   After animation, briefly flash a \"You moved up!\" text for 1.5
    seconds.

-   If position reaches 3: auto-trigger a local flash alert \"You\'re 3
    spots away --- head to the office now!\" even if no socket event
    fires.

**5.5 YourTurnOverlay**

Fires when socket event turn_called arrives and the event
payload.user_id matches the current student.

-   Renders a full-screen overlay (fixed inset-0, z-50, semi-transparent
    dark backdrop).

-   Center card shows: large bell icon, \"YOUR TURN!\", token number,
    counter assignment.

-   Background pulses with a green glow animation.

-   Use Web Speech API: speak \"Your token \[token\], please proceed to
    \[counter\].\" automatically.

-   Large button: \"OK, heading there now\" --- clicking dismisses
    overlay but keeps them on page.

**5.6 Queue Update Handling**

+-----------------------------------------------------------------------+
| socket.on(\'queue_update\', (data) =\> {                              |
|                                                                       |
| // Find this student\'s position in the updated users array           |
|                                                                       |
| const me = data.users.find(u =\> u.token === myData.token);           |
|                                                                       |
| if (me) {                                                             |
|                                                                       |
| setMyData(prev =\> ({ \...prev, position: me.position, status:        |
| me.status }));                                                        |
|                                                                       |
| }                                                                     |
|                                                                       |
| // Update surge state                                                 |
|                                                                       |
| setSurgeActive(data.congestion === \'surge\');                        |
|                                                                       |
| });                                                                   |
|                                                                       |
| socket.on(\'flash_message\', (data) =\> {                             |
|                                                                       |
| // Only show if targeted to this user OR broadcast (no user_id)       |
|                                                                       |
| if (!data.user_id \|\| data.user_id === myData.userId) {              |
|                                                                       |
| setFlashAlert({ message: data.message, type: data.type \|\| \'info\'  |
| });                                                                   |
|                                                                       |
| setTimeout(() =\> setFlashAlert(null), 8000);                         |
|                                                                       |
| }                                                                     |
|                                                                       |
| });                                                                   |
+-----------------------------------------------------------------------+

**6. Page: AdminDashboard (/admin)**

Desktop-optimised. Admin must log in via Google (Firebase Auth). The
dashboard is the admin\'s control room.

  -----------------------------------------------------------------------
  ⛔ Admin has NO \"Call Next\" button. The AI handles all queue
  movement. Admin only confirms physical presence via ATTENDED or
  REMOVED.

  -----------------------------------------------------------------------

**6.1 Authentication Gate**

-   On mount, check Firebase Auth currentUser. If null, show Google
    Sign-In button (Firebase UI / custom).

-   On sign in, verify with backend: GET /api/v1/admin/verify (sends
    Firebase ID token in Authorization header).

-   If not an admin UID, show \"Access Denied\" and sign out.

-   Store auth token for all subsequent admin API calls.

**6.2 Dashboard Layout (Desktop Grid)**

Use a 3-column CSS grid layout for desktop (1280px+). Collapse to single
column on mobile.

  --------------- --------------- ----------------------------------------
  **Column**      **Width**       **Contents**

  Left Panel      \~30%           Queue Stats Card + AI Morning Briefing
                                  Card + Accuracy Graph

  Main Panel      \~50%           Live Queue List (user cards, sorted by
                                  position)

  Right Panel     \~20%           Currently Being Served card +
                                  Alert/Notification tray
  --------------- --------------- ----------------------------------------

**6.3 Queue Stats Card**

-   Shows: total waiting, avg wait time, congestion level (with colour
    indicator), counters open.

-   Updates whenever queue_update socket event fires.

-   Congestion level: green=\"normal\", amber=\"high\", red=\"surge\"
    (with flashing animation on surge).

**6.4 Live Queue List**

Renders each waiting user as a card. Sorted by position (ascending).
Re-renders on queue_update.

  ---------------- ------------------------------------------------------
  **UI Element**   **Spec**

  Position Badge   Large circle with position number (#1, #2\...). #1 is
                   styled as gold/accent.

  Name + Token     User name (bold) + token string below.

  Intent Badge     Colour-coded pill. fee_payment=blue, bonafide=green,
                   tc_mc=orange, scholarship=purple, exam_query=cyan,
                   general=gray, admission=rose. Show intent_details as
                   tooltip.

  Priority Badge   Show \"ELDERLY\" (amber) or \"EMERGENCY\" (red) badge
                   if priority !== \"normal\".

  Ghost Icon       Show grey ghost emoji 👻 when ghost_flag socket event
                   targets this user. Show red ghost when
                   bail_probability \> 85 (user about to be
                   auto-removed).

  Sentiment Badge  Emoji badge: 😊 (1-2), 😐 (3), 😤 (4), 🚨 (5). Show
                   when sentiment_level \>= 3.

  Wait Time        Elapsed wait time since join_time. Live clock
                   (increment every second). Show in red if exceeded
                   predicted time.
  ---------------- ------------------------------------------------------

**6.5 Currently Being Served Card (Right Panel)**

Shows the user currently with status === \"called\" or \"in_service\".
This is the most prominent element on the right panel.

-   Large card with: token number, user name, intent category,
    intent_details.

-   Two action buttons: ATTENDED (green, large) and REMOVED (red,
    large).

-   ATTENDED calls POST /api/v1/queue/:id/attended/:userId. Show
    confirmation spinner.

-   REMOVED calls POST /api/v1/queue/:id/removed/:userId. Show
    confirmation spinner.

-   After either action, the card shows \"Processing\...\" and waits for
    next queue_update to re-populate.

-   Show a service timer: how long the current user has been in_service
    (counts up from attended_time).

-   If no user is currently called: show \"Queue is moving --- AI will
    call next user shortly.\"

  -----------------------------------------------------------------------
  ⚠ Both ATTENDED and REMOVED must disable immediately on click to
  prevent double-tap. Re-enable only on error response.

  -----------------------------------------------------------------------

**6.6 AI Morning Briefing Card**

Shown in the left panel. Fetched from GET /api/v1/queue/:id/briefing on
dashboard mount.

  ---------------------- ------------------------------------------------
  **Briefing Field**     **How to Display**

  expected_peak          Row with clock icon + text. e.g. \"Peak:
                         2pm--4pm (fee deadline today)\"

  staff_recommendation   Row with people icon + text. Amber background if
                         recommendation is urgent.

  top_intents            3 horizontal pills showing top intent
                         categories + percentages.

  efficiency_score       Circular progress ring (0-100). Green \> 80,
                         amber 60-79, red \< 60.

  actionable_tip         Highlighted yellow box: lightbulb icon + tip
                         text in italic.
  ---------------------- ------------------------------------------------

**6.7 Accuracy Graph**

7-day line chart showing predicted vs actual wait times. Uses recharts.

+-----------------------------------------------------------------------+
| import { LineChart, Line, XAxis, YAxis, Tooltip, Legend,              |
| ResponsiveContainer } from \'recharts\';                              |
|                                                                       |
| // Data shape (fetch from GET /api/v1/admin/accuracy-history)         |
|                                                                       |
| const data = \[                                                       |
|                                                                       |
| { day: \'Mon\', predicted: 12, actual: 11 },                          |
|                                                                       |
| { day: \'Tue\', predicted: 14, actual: 13 },                          |
|                                                                       |
| // \...                                                               |
|                                                                       |
| \];                                                                   |
|                                                                       |
| \<ResponsiveContainer width=\'100%\' height={200}\>                   |
|                                                                       |
| \<LineChart data={data}\>                                             |
|                                                                       |
| \<XAxis dataKey=\'day\' /\>                                           |
|                                                                       |
| \<YAxis unit=\'min\' /\>                                              |
|                                                                       |
| \<Tooltip /\>                                                         |
|                                                                       |
| \<Legend /\>                                                          |
|                                                                       |
| \<Line type=\'monotone\' dataKey=\'predicted\' stroke=\'#6C63FF\'     |
| strokeDasharray=\'5 5\' /\>                                           |
|                                                                       |
| \<Line type=\'monotone\' dataKey=\'actual\' stroke=\'#10B981\' /\>    |
|                                                                       |
| \</LineChart\>                                                        |
|                                                                       |
| \</ResponsiveContainer\>                                              |
+-----------------------------------------------------------------------+

**6.8 Notification Tray (Right Panel)**

-   Small tray below the Served card.

-   Shows last 5 system events: fraud_alert, surge_alert, ghost
    auto-removals.

-   Each entry: icon + message + timestamp (relative: \"2 min ago\").

-   fraud_alert: red background, shield icon, \"Fraud attempt blocked:
    \[phone\]\".

-   ghost auto-removal: grey background, ghost icon, \"\[name\]
    auto-removed (ghost)\".

-   surge_alert: amber background, lightning icon, \"Surge detected ---
    queue filling fast\".

**7. Component Library**

All reusable components. Build these first, test in isolation, then
compose into pages.

  -------------------- ----------------------------------- -------------------------------
  **Component**        **File**                            **Props / Notes**

  FlashAlert           components/FlashAlert.jsx           { message, type } ---
                                                           auto-clears after 8s,
                                                           non-dismissible

  SurgeAlert           components/SurgeAlert.jsx           { active } --- orange pulsing
                                                           banner, shown conditionally

  YourTurnOverlay      components/YourTurnOverlay.jsx      { token, counter, onDismiss }
                                                           --- full-screen green overlay
                                                           with TTS

  PositionCard         components/PositionCard.jsx         { position, previous } ---
                                                           animated number countdown card

  WaitEstimate         components/WaitEstimate.jsx         { lower, upper, confidence,
                                                           reason } --- range + badge

  IntentBadge          components/IntentBadge.jsx          { category } --- colour-coded
                                                           pill per intent type

  TokenDisplay         components/TokenDisplay.jsx         { token } --- monospace, large,
                                                           copyable on click

  UserQueueCard        components/UserQueueCard.jsx        { user } --- admin queue list
                                                           row, shows all badges

  AttendedRemovedBar   components/AttendedRemovedBar.jsx   { user, onAttended, onRemoved }
                                                           --- big green/red button pair

  AdminBriefing        components/AdminBriefing.jsx        { briefing } --- structured
                                                           briefing card

  AccuracyGraph        components/AccuracyGraph.jsx        { data } --- recharts 7-day
                                                           line chart wrapper

  QueueStatsCard       components/QueueStatsCard.jsx       { count, avgWait, congestion,
                                                           countersOpen } --- stat tiles
                                                           row

  SkeletonCard         components/SkeletonCard.jsx         Loading placeholder ---
                                                           animate-pulse grey blocks
  -------------------- ----------------------------------- -------------------------------

**8. Intent Category Colour Map**

Use consistently across IntentBadge, UserQueueCard, and admin queue
list. Do not invent new colours.

  ------------------ ------------------ ----------------- ------------------
  **Category**       **Label**          **Tailwind        **Hex**
                                        Class**           

  fee_payment        Fee Payment        bg-blue-100       #DBEAFE / #1E40AF
                                        text-blue-800     

  bonafide_cert      Bonafide Cert      bg-green-100      #D1FAE5 / #065F46
                                        text-green-800    

  tc_mc_request      TC / MC Request    bg-orange-100     #FFEDD5 / #9A3412
                                        text-orange-800   

  scholarship        Scholarship        bg-purple-100     #EDE9FE / #5B21B6
                                        text-purple-800   

  admission          Admission          bg-rose-100       #FFE4E6 / #9F1239
                                        text-rose-800     

  exam_query         Exam Query         bg-cyan-100       #CFFAFE / #155E75
                                        text-cyan-800     

  general            General            bg-gray-100       #F3F4F6 / #374151
                                        text-gray-700     
  ------------------ ------------------ ----------------- ------------------

**9. Environment Variables (.env)**

Place in frontend/.env. Never commit to git. VITE\_ prefix is required
for Vite to expose vars to the browser.

+-----------------------------------------------------------------------+
| \# frontend/.env                                                      |
|                                                                       |
| VITE_BACKEND_URL=http://localhost:3001 \# Railway URL in production   |
|                                                                       |
| VITE_SOCKET_URL=http://localhost:3001 \# Same as backend (Socket.io)  |
|                                                                       |
| VITE_FIREBASE_API_KEY=your_firebase_api_key                           |
|                                                                       |
| VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com                |
|                                                                       |
| VITE_FIREBASE_PROJECT_ID=your-project-id                              |
|                                                                       |
| VITE_FIREBASE_DATABASE_URL=https://your-project-rtdb.firebaseio.com   |
|                                                                       |
| \# NEVER PUT THIS IN FRONTEND:                                        |
|                                                                       |
| \# ANTHROPIC_API_KEY ← BACKEND ONLY. Never in frontend.               |
+-----------------------------------------------------------------------+

  -----------------------------------------------------------------------
  ℹ VITE_BACKEND_URL is used for REST calls. VITE_SOCKET_URL is used for
  Socket.io. They should point to the same Railway URL in production.

  -----------------------------------------------------------------------

**10. API Calls Reference**

All calls from the frontend. Do not add any other backend calls. Prefix
all with VITE_BACKEND_URL + /api/v1.

  ------------ ----------------------------- ------------- -------------------------
  **Method**   **Endpoint**                  **Auth**      **Used On**

  GET          /queue/:id/status             None          LandingPage, WaitingRoom
                                                           (30s poll)

  POST         /queue/:id/join               None          JoinPage submit

  GET          /queue/:id/briefing           Admin Bearer  AdminDashboard on mount

  POST         /queue/:id/attended/:userId   Admin Bearer  AttendedRemovedBar
                                                           ATTENDED click

  POST         /queue/:id/removed/:userId    Admin Bearer  AttendedRemovedBar
                                                           REMOVED click

  POST         /queue/:id/done/:userId       Admin Bearer  Admin marks service
                                                           complete

  GET          /admin/accuracy-history       Admin Bearer  AccuracyGraph on admin
                                                           mount
  ------------ ----------------------------- ------------- -------------------------

  -----------------------------------------------------------------------
  ⛔ POST /queue/:id/next is called INTERNALLY by the backend only. Admin
  never triggers it from the frontend. If you find yourself calling this
  endpoint from the frontend, you have made an error.

  -----------------------------------------------------------------------

**11. Styling System**

**11.1 Design Language**

-   Font: Inter (Google Fonts) --- import in index.html.

-   Base font size: 16px. Line height: 1.5.

-   Border radius: rounded-xl (12px) for cards, rounded-full for
    badges/pills, rounded-2xl for overlays.

-   Shadows: shadow-sm for cards in light mode, shadow-lg for overlays.

-   Primary colour: Violet (#6C63FF). Do not use blue as primary ---
    this is not a government portal.

**11.2 Tailwind Config Additions**

+-----------------------------------------------------------------------+
| // tailwind.config.js                                                 |
|                                                                       |
| module.exports = {                                                    |
|                                                                       |
| content: \[\'./src/\*\*/\*.{js,jsx}\'\],                              |
|                                                                       |
| theme: {                                                              |
|                                                                       |
| extend: {                                                             |
|                                                                       |
| colors: {                                                             |
|                                                                       |
| brand: { DEFAULT: \'#1A1A2E\', light: \'#2D2D5F\' },                  |
|                                                                       |
| accent: { DEFAULT: \'#6C63FF\', light: \'#EDE9FF\', dark: \'#4B44CC\' |
| },                                                                    |
|                                                                       |
| },                                                                    |
|                                                                       |
| animation: {                                                          |
|                                                                       |
| \'position-drop\': \'positionDrop 0.4s ease-out\',                    |
|                                                                       |
| \'flash-in\': \'flashIn 0.3s ease-out\',                              |
|                                                                       |
| },                                                                    |
|                                                                       |
| keyframes: {                                                          |
|                                                                       |
| positionDrop: { \'0%\': { opacity: 0, transform: \'translateY(20px)\' |
| }, \'100%\': { opacity: 1, transform: \'translateY(0)\' } },          |
|                                                                       |
| flashIn: { \'0%\': { opacity: 0, transform: \'translateY(-10px)\' },  |
| \'100%\': { opacity: 1, transform: \'translateY(0)\' } },             |
|                                                                       |
| }                                                                     |
|                                                                       |
| }                                                                     |
|                                                                       |
| }                                                                     |
|                                                                       |
| }                                                                     |
+-----------------------------------------------------------------------+

**11.3 Mobile-First Breakpoints**

-   Student pages (LandingPage, JoinPage, WaitingRoom): max-width 480px
    centred, full-height vh. Design for iPhone SE (375px).

-   AdminDashboard: min-width 1024px. Grid collapses to 1 column below
    768px.

-   All tap targets: minimum 48×48px (Tailwind: min-h-\[48px\]
    min-w-\[48px\]).

**12. Web Push Notifications**

Request permission after the student joins the queue. Use browser
Notification API.

+-----------------------------------------------------------------------+
| // hooks/usePushNotification.js                                       |
|                                                                       |
| export async function requestNotificationPermission() {               |
|                                                                       |
| if (!(\'Notification\' in window)) return false;                      |
|                                                                       |
| const permission = await Notification.requestPermission();            |
|                                                                       |
| return permission === \'granted\';                                    |
|                                                                       |
| }                                                                     |
|                                                                       |
| export function sendPushNotification(title, body) {                   |
|                                                                       |
| if (Notification.permission === \'granted\') {                        |
|                                                                       |
| new Notification(title, { body, icon: \'/icon-192.png\' });           |
|                                                                       |
| }                                                                     |
|                                                                       |
| }                                                                     |
+-----------------------------------------------------------------------+

**Trigger push notification on these events:**

-   turn_approaching socket event: \"You\'re 3 spots away --- head to
    \[queue_name\] now\"

-   turn_called socket event: \"YOUR TURN! Token \[token\] --- proceed
    to \[counter\]\"

-   flash_message with type === \"urgent\": mirror the flash message as
    a push notification

  -----------------------------------------------------------------------
  ℹ Never ask for notification permission on page load. Ask only AFTER
  the student successfully joins the queue (gets a 200 from /join
  endpoint).

  -----------------------------------------------------------------------

**13. Error & Edge Case Handling**

  ---------------------- ------------------------------------------------
  **Scenario**           **Frontend Behaviour**

  Socket disconnects     Show small amber banner: \"Reconnecting\...\"
  mid-wait               --- auto-reconnect via Socket.io built-in.
                         Don\'t eject user.

  Status = removed (user Show full-width card: \"You\'ve been removed
  auto-skipped)          from the queue. This may be due to inactivity.
                         Tap to rejoin.\" Link back to JoinPage.

  status = served (done) Show success screen: \"Service complete! Thank
                         you for using the queue.\" Confetti animation.
                         No redirect.

  API timeout (\>8s)     Show inline error with retry button. Log to
                         console. Never crash the app.

  Queue is paused        Show yellow banner on WaitingRoom: \"Queue
                         temporarily paused by admin. Your position is
                         held.\"

  sessionStorage missing Redirect to / (LandingPage) with queue_id from
  on WaitingRoom         URL params.

  Firebase auth fails on Show \"Sign in failed. Please try again.\" Do
  admin                  not show any queue data.

  briefing not yet       Show skeleton card with \"Briefing
  generated (morning)    generating\... available by 7am\"
  ---------------------- ------------------------------------------------

**14. PWA Configuration**

The student app must be a Progressive Web App so students can add it to
their home screen.

**14.1 vite.config.js**

+-----------------------------------------------------------------------+
| // vite.config.js --- use vite-plugin-pwa                             |
|                                                                       |
| import { VitePWA } from \'vite-plugin-pwa\';                          |
|                                                                       |
| export default {                                                      |
|                                                                       |
| plugins: \[                                                           |
|                                                                       |
| VitePWA({                                                             |
|                                                                       |
| registerType: \'autoUpdate\',                                         |
|                                                                       |
| manifest: {                                                           |
|                                                                       |
| name: \'Invisible Queue\',                                            |
|                                                                       |
| short_name: \'Queue\',                                                |
|                                                                       |
| theme_color: \'#6C63FF\',                                             |
|                                                                       |
| background_color: \'#1A1A2E\',                                        |
|                                                                       |
| display: \'standalone\',                                              |
|                                                                       |
| start_url: \'/\',                                                     |
|                                                                       |
| icons: \[{ src: \'/icon-192.png\', sizes: \'192x192\', type:          |
| \'image/png\' }\]                                                     |
|                                                                       |
| }                                                                     |
|                                                                       |
| })                                                                    |
|                                                                       |
| \]                                                                    |
|                                                                       |
| }                                                                     |
+-----------------------------------------------------------------------+

**14.2 Required Public Assets**

-   /public/icon-192.png --- App icon (192×192px). Design: \"IQ\" text
    on violet (#6C63FF) background.

-   /public/icon-512.png --- Large app icon (512×512px). Same design.

-   /public/og-image.png --- Social preview image 1200×630px for QR
    poster link sharing.

**15. Voice TTS (Web Speech API)**

When YourTurnOverlay renders, speak the turn notification automatically
using the browser\'s built-in speech synthesis.

+-----------------------------------------------------------------------+
| // utils/tts.js                                                       |
|                                                                       |
| export function speakTurn(token, counter) {                           |
|                                                                       |
| if (!window.speechSynthesis) return;                                  |
|                                                                       |
| const utterance = new SpeechSynthesisUtterance(                       |
|                                                                       |
| \`Token \${token}, your turn has arrived. Please proceed to           |
| \${counter}.\`                                                        |
|                                                                       |
| );                                                                    |
|                                                                       |
| utterance.lang = \'en-IN\'; // Indian English voice if available      |
|                                                                       |
| utterance.rate = 0.9;                                                 |
|                                                                       |
| utterance.pitch = 1;                                                  |
|                                                                       |
| window.speechSynthesis.speak(utterance);                              |
|                                                                       |
| }                                                                     |
+-----------------------------------------------------------------------+

-   Call speakTurn() inside YourTurnOverlay on mount.

-   Do not trigger TTS on flash alerts --- only on turn_called.

-   Admin dashboard can also speak: \"Counter 1 is now serving token
    Q-FEE-0042\" using the same utility.

**16. Recommended Build Order**

Follow this order to avoid rework. Each phase produces a testable
milestone.

  -------- ---------------- -------------------------------------------------
  **\#**   **Phase**        **Deliverable**

  1        Setup            Vite project, Tailwind, React Router, .env,
                            folder structure exactly as per Section 10 of
                            backend handoff.

  2        LandingPage      Fetch queue status, show stats, Join button. Test
                            with mock backend response.

  3        JoinPage         Form with all validations, POST /join, store in
                            sessionStorage, navigate to /wait.

  4        WaitingRoom Core Position display, wait estimate, token, intent
                            badge. No Socket.io yet --- just static from
                            sessionStorage.

  5        Socket.io        Connect useSocket hook. Handle queue_update,
                            flash_message, surge_alert, turn_called. Test
                            with real backend.

  6        FlashAlert +     FlashAlert component, YourTurnOverlay, TTS. Test
           Overlay          all socket event triggers.

  7        AdminDashboard   Firebase Auth gate, queue list,
                            AttendedRemovedBar, briefing card, accuracy
                            graph.

  8        PWA + Push       vite-plugin-pwa config, icons, notification
                            permission flow, push triggers.

  9        Demo Prep        Seed demo data. Test all 7 demo scenarios from
                            backend handoff Part 9. Deploy to Vercel.
  -------- ---------------- -------------------------------------------------

**17. What NOT to Build**

  -----------------------------------------------------------------------
  ⛔ These items have been explicitly removed or are not part of the
  frontend scope. Building any of these wastes time and introduces bugs.

  -----------------------------------------------------------------------

  ------------------------- ---------------------------------------------
  **Do NOT Build**          **Reason**

  Chat widget / chat input  Explicitly removed. All communication is
                            system-initiated flash alerts. No text input
                            from student.

  \"Call Next\" or \"Next\" AI auto-advances the queue. Admin only clicks
  button for admin          ATTENDED or REMOVED.

  Claude API calls from     ANTHROPIC_API_KEY is server-side only.
  frontend                  Frontend never calls Claude.

  Admin queue creation /    Queues are pre-created in Firebase. No queue
  setup UI                  management UI needed for hackathon.

  Student authentication /  Students join anonymously. No sign-in, no
  login                     account creation on student side.

  Manual SMS send button    SMS is handled automatically by backend on
                            auto-advance. No SMS UI needed.

  Custom notification       Use basic browser Notification API only. No
  server (VAPID)            service worker push server needed.

  Dark mode                 Out of scope. Ship light mode only.
  ------------------------- ---------------------------------------------

**18. Frontend Demo Readiness Checklist**

Go through every item before the hackathon presentation. Test on a real
mobile device, not just browser devtools.

  ---- ------------------------------------------------------- ------------
       **Checklist Item**                                      **Status**

  □    LandingPage loads and shows live queue stats on mobile  
       (375px)                                                 

  □    Join form validates phone (must be 10-digit, 6-9        
       prefix)                                                 

  □    Joining queue works end-to-end: POST → sessionStorage → 
       navigate to /wait                                       

  □    WaitingRoom shows correct position, token, intent       
       badge, and wait estimate from session                   

  □    Socket.io connects and queue_update event updates       
       position in real-time                                   

  □    flash_message socket event triggers FlashAlert banner   
       (8 second auto-clear)                                   

  □    SurgeAlert orange banner appears when surgeActive =     
       true                                                    

  □    turn_called event triggers full-screen YourTurnOverlay  
       with TTS                                                

  □    Position number animates down when queue_update fires   

  □    At position #3: local flash alert fires automatically   

  □    AdminDashboard requires Google login and verifies admin 
       status                                                  

  □    Admin queue list shows all users with intent badges,    
       ghost flags, sentiment emojis                           

  □    ATTENDED button calls correct endpoint and disables on  
       click                                                   

  □    REMOVED button calls correct endpoint and triggers      
       queue refresh                                           

  □    AI Morning Briefing card renders all 5 fields correctly 

  □    Accuracy graph renders with recharts (predicted vs      
       actual lines)                                           

  □    Notification tray shows fraud_alert and surge_alert     
       entries                                                 

  □    All flash_message types (info/warning/urgent) render    
       with correct colours                                    

  □    No chat widget anywhere in the app                      

  □    No \"Call Next\" button anywhere in admin view          

  □    App works on iPhone Safari (PWA install prompt appears) 

  □    Vercel deployment live and tested on actual mobile      
       device                                                  
  ---- ------------------------------------------------------- ------------

*\"Other teams will digitize the queue. You will give it a brain.\"*

Invisible Queue System --- Frontend Requirements Document --- v1.0 Final
