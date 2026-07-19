# CypherTalk System Documentation 🔐

This document provides a comprehensive technical overview of the security validation protocols, backend token verification engine, database schema mappings, and WebRTC signaling flows implemented in the CypherTalk application.

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
The backend server (`server.js`) verifies all incoming requests using Firebase public certificates dynamically retrieved from Google.

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

---

## 2. Database Mapping (`data.json`)

To map user relations and status parameters while keeping authentication cloud-managed, CypherTalk stores custom profile nodes locally.

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

---

## 3. WebRTC Signaling Protocol (Socket.io)

Since WebRTC operates peer-to-peer (P2P), clients need a signaling server to exchange configuration payloads (SDP Offers, SDP Answers, and ICE Candidates) before a direct connection can be established.

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

### Safety Gates
*   **Busy Rejection**: If Callee is already in an active call, the server automatically rejects the incoming offer.
*   **Offline Dial Handler**: If the Caller dials a User ID that is not connected to the signaling socket, the server intercepts the offer and returns a `'call-rejected'` event with `{ reason: 'offline' }`. The Caller client automatically displays a warning alert and terminates the dial screen.

---

## 4. Media Controllers & Screen Sharing

During an active session, users can control track streaming dynamically:

*   **Mute Microphone**: Retrieves local audio tracks (`localStream.getAudioTracks()`) and toggles `enabled = false`.
*   **Hide Camera**: Retrieves local video tracks (`localStream.getVideoTracks()`) and toggles `enabled = false`.
*   **Screen Sharing**:
    1.  Prompts the user for display window capture: `navigator.mediaDevices.getDisplayMedia({ video: true })`.
    2.  Locates the active WebRTC video sender track.
    3.  Replaces the webcam track with the screen track: `sender.replaceTrack(screenTrack)`.
    4.  Listens for `onended` events (when the user stops sharing) to swap back the webcam track automatically.
