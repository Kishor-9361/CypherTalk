# Prompt for Generating CypherTalk Frontend

Use the following detailed specification to generate a premium, responsive, and fully functional HTML5/JavaScript frontend for a WebRTC video and audio calling application named **CypherTalk**.

---

## 🎨 Design System & Aesthetics
*   **Theme**: Dark mode, high-tech, futuristic dashboard layout.
*   **Palette**:
    *   Deep Space Background: `#0b0f19`
    *   Card / Container Background: `#151d30`
    *   Primary Accent (Indigo/Blue): `#2563eb` with glow effects
    *   Success/Online Indicator (Emerald): `#10b981`
    *   Danger/Hangup/Offline Indicator (Rose): `#f43f5e`
*   **Styling Rules**:
    *   Use a premium font stack (e.g., Google Font 'Inter' or 'Outfit').
    *   Implement **glassmorphism** styling (subtle borders, backdrop blur, soft shadows).
    *   Add micro-animations for hover states, button clicks, and loading spinners.
    *   Use beautiful, uniform SVG icons for controls (microphone, camera, screen-share, phone, settings, copy, QR code).

---

## 📄 Pages and Layout

### 1. Authentication Page (`login.html`)
*   **Structure**: Centered glassmorphic container with two tabs: **Login** and **Register**.
*   **Login Mode**:
    *   Inputs: Email, Password.
    *   Action Button: "Sign In".
*   **Register Mode (OTP Flow)**:
    *   Step 1: Input field for Email. Button "Send Verification Code".
    *   Step 2 (Appears dynamically): Input field for a 6-digit OTP, Display Name, Password, and Confirm Password. Button "Verify & Complete Registration".
*   **Logic**:
    *   Handle backend requests to `/api/send-otp`, `/api/register`, and `/api/login` using `fetch`.
    *   Store `token`, `email`, and `userId` securely in `localStorage` upon success, then redirect to `index.html`.

### 2. Main Dashboard Page (`index.html`)
*   **Structure**: Responsive two-column layout.
    *   **Left Column (Sidebar - 320px wide)**:
        *   **User Details Card**: Display current user's display name, email, and ID. A "Copy ID" button next to their ID.
        *   **QR Code**: Generate and render a QR code of the user's ID for scanning (using `qrcode.js`).
        *   **Contact List**: Scrollable section with a header. Text box at the top to "Add Contact" (input User ID). Below it, render contacts with an active status dot (green for online, gray for offline). Clicking a contact highlights them.
    *   **Right Column (Main Canvas)**:
        *   **State A (Idle)**: Sleek, minimalistic background graphic/message like "Select a contact or enter a User ID to start a secure WebRTC call."
        *   **State B (Outgoing Call - Dialing)**: Pulsing avatar of the contact, "Calling [Name]...", and a red "Cancel" button.
        *   **State C (Incoming Call)**: Ringing animation, caller details, and two prominent buttons: "Accept Call" (glowing green phone icon) and "Decline" (glowing red phone icon).
        *   **State D (Active Call)**: A responsive video grid:
            *   Remote Video (fills the canvas).
            *   Local Video (small floating picture-in-picture box, draggable or anchored in the bottom-right corner).
            *   **Overlay Control Bar**:
                1.  Mute/Unmute Microphone (Toggle style).
                2.  Video On/Off (Toggle style).
                3.  Share Screen / Stop Share.
                4.  Timer (shows elapsed call duration as `MM:SS`).
                5.  End Call (prominent red hangup button).

---

## ⚡ Signaling & WebRTC Logic (`index.html` Script)

Provide complete, robust JavaScript handling Socket.io and native `RTCPeerConnection` matching these event schemas:

```javascript
// 1. Connection
const token = localStorage.getItem('token');
const userId = localStorage.getItem('userId');
const socket = io({ auth: { token } });

// 2. Outgoing Call Sequence
async function initiateCall(targetUserId) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    // Setup media tracks
    const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('call-user', { toUserId: targetUserId, offer });
}

// 3. Incoming Call Sequence
socket.on('incoming-call', async ({ fromUserId, offer }) => {
    // Show Call UI with Accept/Decline
});

// 4. Accept Call & Answer Sequence
async function acceptIncomingCall(fromUserId, offer) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('accept-call', { toUserId: fromUserId, answer });
}

// 5. ICE Candidate Exchange
peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
        socket.emit('ice-candidate', { toUserId: targetUserId, candidate: event.candidate });
    }
};

socket.on('ice-candidate', async ({ candidate }) => {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
});

// 6. Handle Streams
peerConnection.ontrack = (event) => {
    const [remoteStream] = event.streams;
    remoteVideoElement.srcObject = remoteStream;
};
```

---

## 🛠️ Additional Requirements
1.  **Authorization Guard**: If no token is found in `localStorage` on page load, redirect the user immediately to `login.html`.
2.  **Clean Code Structure**: Keep the CSS highly modular (or use standard Tailwind CDN classes if selected) and write readable, well-commented native ES6 JavaScript without external heavy library dependencies except `socket.io-client` and `qrcode.js`.
3.  **Error Handling**: Gracefully handle browser blockages for camera/microphone permissions by showing a user-friendly alert banner.
