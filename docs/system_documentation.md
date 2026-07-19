# CypherTalk System Documentation 🔐

This document provides a comprehensive technical overview of the security validation protocols, backend token verification engine, database schema mappings, WebRTC signaling flows, and client-side resilience mechanisms implemented in the CypherTalk application.

---

## 1. Authentication & Security Validation

CypherTalk replaces custom session credentials with **Firebase ID Tokens (JSON Web Tokens)** to ensure security and prevent unauthorized access.

### Client-Side Flow
1.  **Registration**:
    *   The user inputs their email and password.
    *   The frontend uses the Firebase Client SDK: `createUserWithEmailAndPassword(auth, email, password)`.
    *   An email verification link is sent automatically: `sendEmailVerification(user)`.
    *   The user must click the verification link in their Gmail inbox before they can proceed.
    *   Once verified, the user clicks **Verify & Authorize Node**. The client obtains a fresh Firebase ID Token: `user.getIdToken()`.
    *   The token is sent to the backend `/api/register` endpoint to initialize the user's workspace profile.
2.  **Sign-In**:
    *   The user logs in via `signInWithEmailAndPassword(auth, email, password)`.
    *   The client checks `user.emailVerified`. If false, sign-in is blocked, and a fresh verification link is dispatched.
    *   If true, the ID token is retrieved, saved to `localStorage`, and used to authenticate subsequent HTTP API calls and WebSocket connections.

### Backend ID Token Verification Engine
The backend server (`src/server.js`) verifies all incoming requests using Firebase public certificates dynamically retrieved from Google.

```
+-------------------------------------------------------------+
| 1. Client sends Bearer <token> in Authorization header      |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| 2. Server decodes JWT Header to get Key ID ("kid")          |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| 3. Is Google certificate cached and still valid?            |
|    - Yes: Retrieve certificate from memory cache            |
|    - No: Fetch from Google Certs API & cache it             |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| 4. Verify signature with JWT library using certificate       |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| 5. Validate JWT Claims:                                     |
|    - Audience (aud) matches Firebase Project ID             |
|    - Issuer (iss) matches securetoken.google.com/<project>  |
|    - Token has not expired (exp)                            |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| 6. Extract user UID (sub) and email -> req.user             |
+-------------------------------------------------------------+
```

### WebSocket Re-Authentication & Token Refresh
Since Firebase ID tokens expire after 1 hour, WebSocket connections can fail to reconnect after network dropouts due to token expiration.
*   **Reauth on Failure**: The client-side socket listens for `connect_error`.
*   **Auto-Token Refresh**: If the connection fails with an `Unauthorized` error, the client dynamically calls `user.getIdToken(true)` to pull a fresh token from the Firebase SDK, updates `socket.auth.token`, and connects successfully without page reloads.

---

## 2. Database Mapping & Caching (`data.json`)

To map user relations and status parameters while keeping authentication cloud-managed, CypherTalk stores profile nodes locally.

### Schema Structure
```json
{
  "users": [
    {
      "id": 1,
      "userId": "TABmKZ3QEMQ131d9NRyxeHNK95p1",
      "email": "user@domain.com",
      "displayName": "Alex",
      "contacts": [
        {
          "userId": "another_user_uid",
          "displayName": "Sarah"
        }
      ]
    }
  ],
  "calls": [],
  "nextId": 2,
  "nextCallId": 1
}
```

*   **`userId`**: Stores the unique Firebase User ID (`uid`). This bridges the cloud auth state to our local relationships.
*   **`contacts`**: Represents verified peer channels. Users link contacts by inputting their peer's Secure ID.

### Resilient Client-Side Caching & Auto-Sync
Because Render web services operate on stateless, ephemeral filesystems, the local `data.json` is reset upon server deployments or container restarts, clearing registered accounts.
To prevent contact loss, CypherTalk implements a client-side self-healing sync protocol:
1.  **LocalStorage Backup**: Every successful load of the contact list is cached in the browser's `localStorage` as `contacts_cache`.
2.  **Stateless Self-Healing**: On login, if the client fetches `/api/contacts` and detects that verified friends are missing from the server (due to a database reset), the client automatically sends sync requests to `/api/add-friend` to re-register those users on the fly.
3.  **Placeholder Nodes**: When adding a friend, if the target user ID has not yet registered (or was cleared by a server restart), the server automatically initializes a **placeholder profile** for them. When that friend eventually logs in, their placeholder record is automatically promoted with their Firebase email and display name.

---

## 3. WebRTC Signaling Protocol & Diagnostics (Socket.io)

Since WebRTC operates peer-to-peer (P2P), clients need a signaling server to exchange configuration payloads (SDP Offers, SDP Answers, and ICE Candidates).

### Presence Tracking
The server maintains an in-memory map of online users:
*   `onlineUsers` Map: Maps `userId` (Firebase `uid`) $\rightarrow$ `{ socketId: socket.id }`.
*   When a user connects, the server broadcasts a `'user-status-change'` event: `{ userId, online: true }`.
*   When a user disconnects, the server removes them from the map and broadcasts `{ userId, online: false }`.

### Calling Event Sequence
```
Caller (Alice)                 Signaling Server                 Callee (Bob)
     |                                |                              |
     |--- 1. call-user -------------->|                              |
     |    { toUserId: Bob, offer }    |--- 2. incoming-call -------->|
     |                                |    { fromUserId: Alice }     |
     |                                |                              |
     |                                |<-- 3. accept-call -----------|
     |<-- 4. call-accepted -----------|    { toUserId: Alice }       |
     |    { fromUserId: Bob }         |                              |
     |                                |                              |
     |=== 5. Exchange ICE Candidates via signaling server ===========|
     |                                |                              |
     |================== 6. Direct P2P Media Stream =================|
```

### Safety Gates & Race Condition Resolutions
*   **Busy Rejection**: If Callee is already in an active call, the server automatically rejects the incoming offer.
*   **Offline Dial Handler**: If the Caller dials a User ID that is not connected to the signaling socket, the server intercepts the offer and returns a `'call-rejected'` event with `{ reason: 'offline' }`.
*   **Accept-Call Offline Guard**: If the caller disconnects before the callee accepts the call, the server notifies the callee with `call-ended` instead of letting them enter a stuck, empty active call screen.
*   **ICE Candidate Queueing**: ICE candidates are exchanged rapidly. If candidates arrive *before* `setRemoteDescription()` completes, WebRTC throws an error. CypherTalk queues early remote candidates in `iceCandidatesQueue` and flushes them to the peer connection only after session descriptions are set, preventing NAT traversal failures.

### Real-Time Diagnostics
To assist in tracing connection dropouts, the dialing and call screens display active diagnostics:
*   **Visual ICE State Indicator**: Real-time rendering of connection state (`new`, `checking`, `connected`, `failed`).
*   **ICE Failures Alert**: If the state transitions to `failed` (e.g. firewalls blocking media or P2P failure), the client alerts the user and terminates the call gracefully.

---

## 4. Media Controllers, Device Fallbacks & Sharing

During an active session, users can control track streaming dynamically:

*   **Mute Microphone**: Retrieves local audio tracks (`localStream.getAudioTracks()`) and toggles `enabled = false`.
*   **Hide Camera**: Retrieves local video tracks (`localStream.getVideoTracks()`) and toggles `enabled = false`.
*   **Screen Sharing**:
    1.  Prompts the user for display window capture: `navigator.mediaDevices.getDisplayMedia({ video: true })`.
    2.  Locates the active WebRTC video sender track.
    3.  Replaces the webcam track with the screen track: `sender.replaceTrack(screenTrack)`.
    4.  Listens for `onended` events to swap back the webcam track automatically.
*   **Graceful Media Device Fallback**: If calling `{ video: true, audio: true }` fails because a device lacks a camera (e.g. desktop PC) or the video device is in-use by another application, the system automatically falls back to an **audio-only call**, ensuring connectivity.
*   **Descriptive Diagnostic Alerts**: Replaces generic errors with clear alerts for permissions (`NotAllowedError`), missing devices (`NotFoundError`), or active in-use hardware (`NotReadableError`).

---

## 5. Media Encryption & Network Traversal (SRTP, DTLS, STUN/TURN)

WebRTC enforces security directly at the browser transport layer. Media streams (audio, video, and screen sharing) are fully encrypted.

### A. Secure Real-time Transport Protocol (SRTP)
*   **Encrypted Packets**: All raw RTP packets (containing video frames and audio samples) are encrypted using **SRTP** before being sent over the network.
*   **Cryptographic Strength**: WebRTC defaults to **AES-GCM** with 128-bit or 256-bit keys, ensuring data confidentiality and packet integrity.

### B. Datagram Transport Layer Security (DTLS)
*   **Key Exchange**: The cryptographic keys used for SRTP encryption are negotiated directly between the two browser nodes using a **DTLS handshake** over the peer connection, keeping keys private from the signaling server.
*   **Perfect Forward Secrecy (PFS)**: DTLS generates unique, ephemeral session keys. If a key is compromised, it cannot be used to decrypt past or future calling sessions.

### C. NAT & Firewall Traversal (STUN/TURN)
To establish peer connections across separate networks (like home Wi-Fi and mobile CGNAT), CypherTalk incorporates:
1.  **Google STUN Server Cluster**: Resolves public NAT endpoints.
2.  **Metered OpenRelay TURN Servers**: Relays encrypted SRTP media packets on ports `80` and `443` (TCP/UDP) when symmetric firewalls block direct hole punching. E2EE is fully maintained because the TURN server cannot decrypt the SRTP payload.

```
[Alice Browser] <========= Direct P2P Tunnel (SRTP/DTLS) =========> [Bob Browser]
       ^                                                                   ^
       |                                                                   |
       +----- Signaling Channel (WSS + Firebase JWT Auth) -----+           |
                                 |                              |           |
                                 v                              |           |
                      [CypherTalk Server] ----------------------+-----------+
                      (Relays Offers/Answers only;
                       CANNOT view/decrypt media)
```

---

## 6. Project Directory Layout

The CypherTalk codebase is organized into modular directories for clean separation of concerns:

```
CypherTalk/
├── docs/                      # Documentation and prompts
│   ├── system_documentation.md
│   └── frontend_prompt.md
├── src/                       # Backend source code
│   └── server.js
├── tests/                     # Test clients and mock scripts
│   └── test_signaling.js
├── public/                    # Static frontend assets
│   ├── index.html
│   ├── login.html
│   ├── dashboard.html         # Mock dashboard reference
│   └── architecture.html      # Git-ignored sequential architecture visualizer
├── .env                       # Environment credentials (local)
├── data.json                  # Local database file
├── package.json               # Node.json scripts and dependencies
└── .gitignore                 # Excluded files list
```
ys.
