# CypherTalk 🔐

A premium, secure WebRTC-based audio and video calling platform. Built with a futuristic glassmorphic UI design (**Obsidian Nebula**) and an in-memory/file-based Socket.io signaling server.

## 🚀 Features

*   **Secure Authentication**: Dual Sign-in and OTP-based Registration (using mock/live SMTP).
*   **Encrypted WebRTC Uplink**: Real-time peer-to-peer audio/video streaming, ICE candidate negotiation, and remote/local stream management.
*   **Obsidian Nebula UI**: A responsive, dark-mode technical dashboard styled with Tailwind CSS, backdrop blurs, Outfit/Inter typography, and Material symbols.
*   **Verified Contacts Manager**: Add contacts by their Secure User ID, copy your unique ID, and generate shareable QR Codes.
*   **Presence Indicators**: Live connection state tracking (online/offline) for all contacts via dynamic socket notifications.
*   **Media Controllers**: Integrated toggles for Mute (Mic), Hide (Camera), and native Screen Sharing.

---

## 🛠️ Technical Stack

*   **Backend**: Node.js, Express, Socket.io, JSON Database, JWT, NodeMailer, BcryptJS.
*   **Frontend**: HTML5, Vanilla JavaScript, Tailwind CSS (CDN), Material Symbols, QRCode.js.
*   **Signaling Protocol**: Custom Socket.io events (`call-user`, `accept-call`, `ice-candidate`, `end-call`).

---

## 🏁 Getting Started

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org) installed on your machine.

### 2. Installation
Install the project dependencies:
```bash
npm install
```

### 3. Running the Server
Start the Express server on port `3000`:
```bash
npm start
```
The application will be accessible at [http://localhost:3000](http://localhost:3000).

### 4. Running the Signaling Tests
Run the mock signaling client to verify Socket.io connectivity:
```bash
node test_signaling.js
```

---

## 📂 Project Structure

```
├── public/                 # Static web assets
│   ├── index.html          # Secure calling dashboard
│   ├── login.html          # Tabbed access & registration portal
│   └── dashboard.html      # Redirection logic
├── data.json               # Local database (gitignored)
├── server.js               # Express & Socket.io server
├── test_signaling.js       # Signaling test script
├── package.json            # Node.js project configuration
└── .gitignore              # Ignored file patterns
```
