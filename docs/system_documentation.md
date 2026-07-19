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

---

## 5. Media Encryption & Stream Security (SRTP, DTLS, E2EE)

WebRTC enforces mandatory security protocols directly at the browser transport layer. Media streams (audio, video, and screen sharing) are fully encrypted and validated to prevent eavesdropping and tampering.

### A. Secure Real-time Transport Protocol (SRTP)
*   **Encrypted Packets**: All raw RTP packets (containing video frames and audio samples) are encrypted using **SRTP** before being sent over the network.
*   **Cryptographic Strength**: WebRTC defaults to **AES-GCM (Advanced Encryption Standard with Galois/Counter Mode)** with 128-bit or 256-bit keys, ensuring both data confidentiality and packet integrity.

### B. Datagram Transport Layer Security (DTLS)
*   **Key Exchange**: The cryptographic keys used for SRTP encryption are **not** exchanged via the signaling server. Instead, they are dynamically negotiated directly between the two browser nodes using a **DTLS handshake** over the peer connection.
*   **Perfect Forward Secrecy (PFS)**: DTLS generates unique, ephemeral session keys. If a key is compromised, it cannot be used to decrypt past or future calling sessions.

### C. End-to-End Encryption (E2EE) Validation
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
1.  **P2P Isolation**: Because the media stream flows directly between Alice and Bob (Peer-to-Peer), the CypherTalk server acts *only* as a signaling route. It has **no access** to the DTLS keys and **cannot decrypt** the media packets.
2.  **STUN/TURN Transport Security**: Even when firewall restrictions require using a TURN relay server to route packets, the TURN server acts as a blind relay. Because SRTP is applied end-to-end (at the browser endpoints), the TURN server only forwards encrypted UDP payloads without access to the decryption keys.
